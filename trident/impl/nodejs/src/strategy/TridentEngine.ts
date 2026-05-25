import type { QSConfig } from '../config/types.js';
import type { SignalFile, ActiveLevels } from '../signal/types.js';
import type { Notifier } from '../notifier/Notifier.js';
import type { ActivePosition, EntryLevel, Fill, PositionState } from './types.js';
import {
  calculateEntries,
  calculateAvgEntry,
  calculateStop,
  pnlPoints,
  isEntryTriggered,
  isStopHit,
  isVwapHit,
} from './calculator.js';
import { validateSignal } from '../signal/validator.js';
import { getLogger } from '../logger.js';
import { buildSnapshot, clearSnapshot, loadSnapshot, saveSnapshot } from './persistence.js';

const log = getLogger('TridentEngine');

/**
 * The Trident strategy state machine.
 *
 * Lifecycle:
 *   1. loadSignal()        — validates and sets up the trade structure
 *   2. onPriceUpdate()     — called on every tick; drives all logic
 *   3. Signal file updates mid-session replace the setup if no trade is active
 *
 * One instance per trading session. Re-create for a new day.
 */
export class TridentEngine {
  private config: QSConfig;
  private notifier: Notifier;

  private state: PositionState = 'idle';
  private currentSignal: SignalFile | null = null;
  private signalFilePath: string | null = null;
  private activeLevels: ActiveLevels | null = null;
  private tradeSetup: EntryLevel[] | null = null;
  private position: ActivePosition | null = null;
  private dailyLocked = false;
  private timeExitTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotPath: string | null;

  constructor(config: QSConfig, notifier: Notifier, opts: { snapshotPath?: string | null } = {}) {
    this.config = config;
    this.notifier = notifier;
    this.snapshotPath = opts.snapshotPath === undefined ? 'logs/engine-state.json' : opts.snapshotPath;
    log.info('Engine initialised', {
      dvs_gate: config.trident.dvs_gate,
      stop_loss_points: config.trident.stop_loss_points,
      time_exit_minutes: config.trident.time_exit_minutes,
      snapshotPath: this.snapshotPath ?? '<disabled>',
    });

    if (this.snapshotPath) {
      this.hydrateFromSnapshot(this.snapshotPath);
    }
  }

  // ---------------------------------------------------------------------------
  // Snapshot hydration
  // ---------------------------------------------------------------------------

  private hydrateFromSnapshot(path: string): void {
    const restored = loadSnapshot(path);
    if (!restored) return;

    this.state = restored.state;
    this.currentSignal = restored.currentSignal;
    this.signalFilePath = restored.signalFilePath;
    this.activeLevels = restored.activeLevels;
    this.tradeSetup = restored.tradeSetup;
    this.position = restored.position;
    this.dailyLocked = restored.dailyLocked;

    if (this.position && this.state === 'in_trade') {
      const elapsedMs = Date.now() - this.position.lastFillTime.getTime();
      const limitMs = this.config.trident.time_exit_minutes * 60 * 1000;
      const remaining = limitMs - elapsedMs;
      if (remaining > 0) {
        log.info('Rehydrating time-exit timer', {
          remainingMinutes: (remaining / 60000).toFixed(1),
        });
        this.scheduleTimeExit(remaining);
      } else {
        // Deadline already passed while we were down. The first onPriceUpdate
        // will detect this and close as time_exit (see enforceTimeExitDeadline).
        log.warn('Time-exit deadline already elapsed during downtime — will close on next price tick', {
          overshotMinutes: (-remaining / 60000).toFixed(1),
        });
      }
    }
  }

  private persist(): void {
    if (!this.snapshotPath) return;
    try {
      saveSnapshot(this.snapshotPath, buildSnapshot({
        state: this.state,
        dailyLocked: this.dailyLocked,
        currentSignal: this.currentSignal,
        signalFilePath: this.signalFilePath,
        activeLevels: this.activeLevels,
        tradeSetup: this.tradeSetup,
        position: this.position,
      }));
    } catch (err) {
      log.error('Failed to persist engine snapshot', { error: (err as Error).message });
    }
  }

  // ---------------------------------------------------------------------------
  // Signal loading
  // ---------------------------------------------------------------------------

  async loadSignal(signal: SignalFile, filePath: string): Promise<void> {
    log.info('Setup received', {
      filePath,
      date: signal.meta?.date,
      update_seq: signal.meta?.update_seq,
      dvs: signal.volatility?.dvs,
      regime: signal.volatility?.regime,
    });

    const { stale_threshold_hours, vwap_staleness_warn_minutes } = this.config.signal;

    const result = validateSignal(signal, {
      staleThresholdHours: stale_threshold_hours,
      vwapStalenessWarnMinutes: vwap_staleness_warn_minutes,
    });

    if (!result.valid) {
      log.error('Setup rejected — validation failed', { errors: result.errors });
      await this.notifier.notify({ type: 'SIGNAL_INVALID', filePath, errors: result.errors });
      return;
    }

    if (result.warnings.length > 0) {
      await this.notifier.notify({ type: 'SIGNAL_WARNING', filePath, warnings: result.warnings });
    }

    await this.notifier.notify({ type: 'SIGNAL_LOADED', signal, filePath });

    // DVS gate
    const { dvs } = signal.volatility;
    const gate = this.config.trident.dvs_gate;
    if (dvs > gate) {
      log.warn('DVS gate triggered — no trades today', { dvs, gate });
      await this.notifier.notify({ type: 'DVS_GATE_BLOCKED', dvs, gate });
      this.state = 'blocked';
      this.persist();
      return;
    }
    log.info('DVS gate passed', { dvs, gate, margin: (gate - dvs).toFixed(2) });

    if (this.dailyLocked) {
      log.info('Daily lock active — ignoring new setup', { filePath });
      return;
    }

    if (this.state === 'in_trade') {
      log.info('Trade already active — ignoring level update from new setup', {
        update_seq: signal.meta.update_seq,
      });
      return;
    }

    this.currentSignal = signal;
    this.signalFilePath = filePath;

    const levels = resolveActiveLevels(signal);
    this.activeLevels = levels;
    log.debug('Active levels resolved', {
      source: levels.level_time,
      max_buy_1: levels.max_buy_1,
      max_buy_2: levels.max_buy_2,
      max_sell_1: levels.max_sell_1,
      max_sell_2: levels.max_sell_2,
    });

    await this.setupTrade();
  }

  // ---------------------------------------------------------------------------
  // Price updates — the main logic loop
  // ---------------------------------------------------------------------------

  async onPriceUpdate(price: number): Promise<void> {
    await this.notifier.notify({ type: 'PRICE_UPDATE', price });

    if (this.state === 'idle' || this.state === 'blocked' || this.state === 'closed') return;

    if (!this.currentSignal || !this.tradeSetup) return;

    log.debug('Price tick', { price, state: this.state });

    // Time-exit safety net. The scheduled timer handles the normal case, but
    // after a crash/restart the deadline may have passed while we were down.
    // This check catches that (and any other timer miss) on the next tick.
    if (
      this.state === 'in_trade' &&
      this.position &&
      Date.now() - this.position.lastFillTime.getTime() >= this.config.trident.time_exit_minutes * 60 * 1000
    ) {
      log.warn('Time-exit deadline detected on price tick', { price });
      await this.closePosition(price, 'time_exit');
      return;
    }

    // Invalidation check (always runs, even before entry)
    const { void_above, void_below, expiry } = this.currentSignal.invalidation;
    if (price >= void_above || price <= void_below) {
      log.warn('Invalidation boundary hit', { price, void_above, void_below });
      await this.closePosition(price, 'invalidation');
      return;
    }

    // Expiry check
    if (isPastExpiry(this.currentSignal.meta.date, expiry)) {
      log.warn('Setup expiry reached', { expiry });
      await this.closePosition(price, 'expiry');
      return;
    }

    if (this.state === 'watching') {
      await this.checkEntryTrigger(price);
      return;
    }

    if (this.state === 'in_trade') {
      await this.checkExitConditions(price);
      await this.checkPendingEntries(price);
    }
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  private async setupTrade(): Promise<void> {
    if (!this.currentSignal || !this.activeLevels) return;

    const signal = this.currentSignal;
    const levels = this.activeLevels;
    const biasDir = signal.bias?.direction;

    const canLong =
      biasDir !== 'short' &&
      levels.max_buy_1 !== null &&
      levels.max_buy_2 !== null;
    const canShort =
      biasDir !== 'long' &&
      levels.max_sell_1 !== null &&
      levels.max_sell_2 !== null;

    log.debug('Trade eligibility', {
      bias: biasDir ?? 'none',
      canLong,
      canShort,
      max_buy_1: levels.max_buy_1,
      max_buy_2: levels.max_buy_2,
      max_sell_1: levels.max_sell_1,
      max_sell_2: levels.max_sell_2,
    });

    if (!canLong && !canShort) {
      log.warn('No trade setup possible — required levels missing');
      await this.notifier.notify({
        type: 'NO_TRADE_SETUP',
        reason: 'Required levels are missing — need both BUY INNER+OUTER or both SELL INNER+OUTER',
      });
      this.state = 'idle';
      this.persist();
      return;
    }

    let direction: 'long' | 'short';
    let innerLevel: number;
    let outerLevel: number;

    if (canLong && (biasDir === 'long' || biasDir === 'neutral' || !biasDir || !canShort)) {
      direction = 'long';
      innerLevel = levels.max_buy_2!;
      outerLevel = levels.max_buy_1!;
    } else {
      direction = 'short';
      innerLevel = levels.max_sell_2!;
      outerLevel = levels.max_sell_1!;
    }

    const entries = calculateEntries(direction, innerLevel, outerLevel, this.config);
    this.tradeSetup = entries;
    this.state = 'watching';

    log.info('Trade setup ready — watching for entry', {
      direction,
      entry1: entries[0].price,
      entry2: entries[1].price,
      entry3: entries[2].price,
      vwap: signal.vwap.value,
      stop_points: this.config.trident.stop_loss_points,
    });

    await this.notifier.notify({
      type: 'SETUP_READY',
      direction,
      entries,
      stopPoints: this.config.trident.stop_loss_points,
      vwap: signal.vwap.value,
    });

    this.persist();
  }

  // ---------------------------------------------------------------------------
  // Entry logic
  // ---------------------------------------------------------------------------

  private async checkEntryTrigger(price: number): Promise<void> {
    if (!this.tradeSetup || !this.currentSignal) return;

    const inferredDirection = this.inferDirection();
    if (!inferredDirection) return;

    const entry1 = this.tradeSetup[0];
    log.debug('Checking entry 1 trigger', {
      direction: inferredDirection,
      entryPrice: entry1.price,
      currentPrice: price,
      triggered: inferredDirection === 'long' ? price <= entry1.price : price >= entry1.price,
    });

    if (isEntryTriggered(inferredDirection, entry1.price, price)) {
      await this.fillEntry(entry1, price, inferredDirection);
    }
  }

  private async checkPendingEntries(price: number): Promise<void> {
    if (!this.position) return;

    const { direction, pendingEntries, breakEvenActive } = this.position;

    if (breakEvenActive) {
      log.debug('Breakeven active — pending entries cancelled, skipping trigger check');
      return;
    }

    for (const pending of [...pendingEntries]) {
      const triggered = isEntryTriggered(direction, pending.price, price);
      log.debug('Checking pending entry trigger', {
        entryNumber: pending.entryNumber,
        entryPrice: pending.price,
        currentPrice: price,
        triggered,
      });
      if (triggered) {
        await this.fillEntry(pending, price, direction);
        break;
      }
    }
  }

  private async fillEntry(entry: EntryLevel, price: number, direction: 'long' | 'short'): Promise<void> {
    if (!this.currentSignal) return;

    const fill: Fill = {
      entryNumber: entry.entryNumber,
      price,
      allocationPct: entry.allocationPct,
      filledAt: new Date(),
    };

    if (!this.position) {
      const avgEntry = price;
      const stop = calculateStop(direction, avgEntry, this.config.trident.stop_loss_points);
      const pendingEntries = (this.tradeSetup ?? []).filter(e => e.entryNumber !== entry.entryNumber);

      this.position = {
        direction,
        fills: [fill],
        pendingEntries,
        avgEntry,
        currentStop: stop,
        vwapTarget: this.currentSignal.vwap.value,
        lastFillTime: fill.filledAt,
        breakEvenActive: false,
      };
      this.state = 'in_trade';
      this.resetTimeExitTimer();

      log.info('Entry 1 filled — position opened', {
        direction,
        fillPrice: price,
        allocation: `${entry.allocationPct}%`,
        avgEntry,
        stop,
        vwapTarget: this.position.vwapTarget,
        pendingEntries: pendingEntries.map(e => e.price),
      });
    } else {
      this.position.fills.push(fill);
      this.position.pendingEntries = this.position.pendingEntries.filter(
        e => e.entryNumber !== entry.entryNumber
      );
      this.position.lastFillTime = fill.filledAt;
      const prevAvg = this.position.avgEntry;
      this.position.avgEntry = calculateAvgEntry(this.position.fills);
      this.position.currentStop = calculateStop(
        direction,
        this.position.avgEntry,
        this.config.trident.stop_loss_points
      );
      this.resetTimeExitTimer();

      log.info(`Entry ${entry.entryNumber} filled — position scaled in`, {
        entryNumber: entry.entryNumber,
        fillPrice: price,
        allocation: `${entry.allocationPct}%`,
        prevAvgEntry: prevAvg.toFixed(2),
        newAvgEntry: this.position.avgEntry.toFixed(2),
        newStop: this.position.currentStop.toFixed(2),
        fillsRemaining: this.position.pendingEntries.length,
      });
    }

    await this.notifier.notify({
      type: 'ENTRY_TRIGGERED',
      entryNumber: entry.entryNumber,
      price,
      direction,
      allocationPct: entry.allocationPct,
      avgEntry: this.position.avgEntry,
      currentStop: this.position.currentStop,
      fillsRemaining: this.position.pendingEntries.length,
    });

    this.persist();
  }

  // ---------------------------------------------------------------------------
  // Exit logic
  // ---------------------------------------------------------------------------

  private async checkExitConditions(price: number): Promise<void> {
    if (!this.position) return;

    const { direction, avgEntry, currentStop, vwapTarget, breakEvenActive } = this.position;
    const pnl = pnlPoints(direction, avgEntry, price);

    log.debug('Exit condition check', {
      price,
      direction,
      avgEntry: avgEntry.toFixed(2),
      currentStop: currentStop.toFixed(2),
      vwapTarget,
      pnl: pnl.toFixed(2),
      breakEvenActive,
    });

    // 1. Stop loss
    if (isStopHit(direction, currentStop, price)) {
      log.warn('Stop loss hit', { price, stop: currentStop, pnl: pnl.toFixed(2) });
      await this.closePosition(price, 'stop_loss');
      return;
    }

    // 2. VWAP hit (primary target)
    if (isVwapHit(direction, vwapTarget, price)) {
      log.info('VWAP target hit', { price, vwap: vwapTarget, pnl: pnl.toFixed(2) });
      await this.closePosition(price, 'vwap_hit');
      return;
    }

    // 3. Hard profit exit (+33 pts)
    if (pnl >= this.config.trident.hard_profit_exit_points) {
      log.info('Hard profit exit triggered', {
        price,
        pnl: pnl.toFixed(2),
        threshold: this.config.trident.hard_profit_exit_points,
      });
      await this.closePosition(price, 'hard_profit_exit');
      return;
    }

    // 4. Breakeven trigger (+25 pts) — modifies stop, does not close
    if (!breakEvenActive && pnl >= this.config.trident.breakeven_trigger_points) {
      this.position.breakEvenActive = true;
      this.position.currentStop = avgEntry;
      this.position.pendingEntries = [];

      log.info('Breakeven triggered — stop moved to avg entry, pending entries cancelled', {
        pnl: pnl.toFixed(2),
        newStop: avgEntry.toFixed(2),
        threshold: this.config.trident.breakeven_trigger_points,
      });

      await this.notifier.notify({
        type: 'BREAKEVEN_TRIGGERED',
        newStop: avgEntry,
      });

      this.persist();
    }
  }

  private async closePosition(price: number, reason: import('./types.js').CloseReason): Promise<void> {
    this.cancelTimeExitTimer();

    if (this.position) {
      const { direction, avgEntry } = this.position;
      const pnl = pnlPoints(direction, avgEntry, price);
      const isWin = pnl > 0;

      log.info('Position closed', {
        reason,
        direction,
        avgEntry: avgEntry.toFixed(2),
        closePrice: price,
        pnlPoints: pnl.toFixed(2),
        result: isWin ? 'WIN' : 'LOSS',
        fillCount: this.position.fills.length,
      });

      await this.notifier.notify({
        type: 'POSITION_CLOSED',
        reason,
        direction,
        avgEntry,
        closePrice: price,
        pnlPoints: pnl,
      });

      if (isWin) {
        await this.applyDailyLock('one winning trade closed');
      }
    } else if (this.state === 'watching') {
      log.info('Setup invalidated before entry', { reason, price });
      await this.notifier.notify({
        type: 'POSITION_CLOSED',
        reason,
        direction: 'long',
        avgEntry: 0,
        closePrice: price,
        pnlPoints: 0,
      });
    }

    this.position = null;
    this.tradeSetup = null;
    this.currentSignal = null;
    this.signalFilePath = null;
    this.activeLevels = null;
    this.state = 'closed';
    this.persist();
  }

  // ---------------------------------------------------------------------------
  // Daily lock
  // ---------------------------------------------------------------------------

  private async applyDailyLock(reason: string): Promise<void> {
    this.dailyLocked = true;
    this.state = 'closed';
    log.info('Daily lock applied', { reason });
    await this.notifier.notify({ type: 'DAILY_LOCK', reason });
    this.persist();
  }

  // ---------------------------------------------------------------------------
  // Time exit timer (180 min from last fill)
  // ---------------------------------------------------------------------------

  private resetTimeExitTimer(): void {
    const ms = this.config.trident.time_exit_minutes * 60 * 1000;
    log.debug('Time exit timer reset', { minutes: this.config.trident.time_exit_minutes });
    this.scheduleTimeExit(ms);
  }

  /** Schedule a time-exit firing `ms` from now, replacing any existing timer. */
  private scheduleTimeExit(ms: number): void {
    this.cancelTimeExitTimer();
    this.timeExitTimer = setTimeout(async () => {
      if (this.state !== 'in_trade' || !this.position) return;
      log.warn('Time exit triggered', { minutes: this.config.trident.time_exit_minutes });
      const latestPrice = await this.getLatestPrice();
      if (latestPrice !== null) {
        await this.closePosition(latestPrice, 'time_exit');
      }
    }, Math.max(0, ms));
  }

  private cancelTimeExitTimer(): void {
    if (this.timeExitTimer) {
      clearTimeout(this.timeExitTimer);
      this.timeExitTimer = null;
      log.debug('Time exit timer cancelled');
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private inferDirection(): 'long' | 'short' | null {
    if (!this.tradeSetup || this.tradeSetup.length === 0) return null;
    const e1 = this.tradeSetup[0].price;
    const e3 = this.tradeSetup[2].price;
    return e3 < e1 ? 'long' : 'short';
  }

  protected async getLatestPrice(): Promise<number | null> {
    return null;
  }

  // ---------------------------------------------------------------------------
  // Inspection (for tests and dashboards)
  // ---------------------------------------------------------------------------

  getState(): PositionState {
    return this.state;
  }

  getPosition(): ActivePosition | null {
    return this.position;
  }

  isLockedForDay(): boolean {
    return this.dailyLocked;
  }

  getCurrentSignal(): SignalFile | null {
    return this.currentSignal;
  }

  getSignalFilePath(): string | null {
    return this.signalFilePath;
  }

  reset(): void {
    this.cancelTimeExitTimer();
    this.state = 'idle';
    this.currentSignal = null;
    this.signalFilePath = null;
    this.activeLevels = null;
    this.tradeSetup = null;
    this.position = null;
    this.dailyLocked = false;
    log.info('Engine reset for new trading day');
    if (this.snapshotPath) {
      clearSnapshot(this.snapshotPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function resolveActiveLevels(signal: SignalFile): ActiveLevels {
  const recal = signal.levels_recal;
  if (recal?.level_time) {
    log.debug('Using recalibrated levels', { level_time: recal.level_time });
    return {
      level_time: recal.level_time,
      max_sell_1: recal.max_sell_1,
      max_sell_2: recal.max_sell_2,
      max_buy_1: recal.max_buy_1,
      max_buy_2: recal.max_buy_2,
    };
  }
  log.debug('Using morning levels', { level_time: signal.levels.level_time });
  return {
    level_time: signal.levels.level_time ?? '',
    max_sell_1: signal.levels.max_sell_1,
    max_sell_2: signal.levels.max_sell_2,
    max_buy_1: signal.levels.max_buy_1,
    max_buy_2: signal.levels.max_buy_2,
  };
}

function isPastExpiry(date: string, expiryTime: string): boolean {
  const expiry = new Date(`${date}T${expiryTime}:00`);
  return Date.now() >= expiry.getTime();
}
