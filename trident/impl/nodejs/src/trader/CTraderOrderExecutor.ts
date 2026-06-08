/**
 * src/trader/CTraderOrderExecutor.ts
 *
 * Phase 2 auto-execution: places market orders at the broker when the engine
 * fires entry/breakeven/close events. Implements the Notifier interface so it
 * sits on the MultiNotifier chain alongside ConsoleNotifier and WebSocketNotifier.
 *
 * Uses its own CTraderSession (C3 design — independent from price feed (C1)
 * and balance session (C2)). Only instantiated when config.execution.auto_execute
 * is true.
 *
 * Volume formula: floor((capital × riskPct/100 × allocPct/100) / (stopPoints × pointValue))
 *
 * NOTE: cTrader volume units — confirm on first real run. For most Pepperstone
 * CFDs the API accepts volume in "lots × 100" (e.g. 1 lot = 100). Verify the
 * unit for US500.cash and update VOLUME_MULTIPLIER if needed.
 */

import { CTraderSession, PT } from '../price-feed/CTraderSession.js';
import type { CTraderSessionConfig, CTraderMessage } from '../price-feed/CTraderSession.js';
import type { Notifier, NotificationEvent } from '../notifier/Notifier.js';
import type { QSConfig } from '../config/types.js';
import { computeVolume } from './volumeCalculator.js';
import { getLogger } from '../logger.js';

const log = getLogger('CTraderOrderExecutor');

// Verify this multiplier on the first real run. cTrader usually encodes volume
// as integer lots × 100 (so 1 lot = 100 in the API). If the broker uses a
// different convention adjust here.
const VOLUME_MULTIPLIER = 100;

// ── Types ────────────────────────────────────────────────────────────────────

export interface CTraderOrderExecutorConfig extends CTraderSessionConfig {
  symbolId?: number;
}

// ── CTraderOrderExecutor ─────────────────────────────────────────────────────

export class CTraderOrderExecutor implements Notifier {
  private readonly session: CTraderSession;
  private readonly qsConfig: QSConfig;
  private symbolId: number | null;

  private positionId: number | null = null;
  private totalVolume = 0;                   // accumulated across all fills
  private pendingStopPrice: number | null = null; // queued SL amend before positionId known
  private orderTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(cfg: CTraderOrderExecutorConfig, qsConfig: QSConfig) {
    this.qsConfig = qsConfig;
    this.symbolId = cfg.symbolId ?? null;
    this.session  = new CTraderSession(cfg);

    this.session.onMessage(PT.EXECUTION_EVENT, msg => {
      this.handleExecutionEvent(msg.payload ?? {});
    });

    this.session.onMessage(PT.ERROR_RES, msg => {
      const desc = (msg.payload?.['description'] as string | undefined) ?? 'unknown error';
      log.error('Broker ERROR_RES received', { payload: msg.payload });
      this.emitOrderFailed(desc).catch(() => {});
    });

    this.session.onMessage(PT.ORDER_ERROR_EVENT, msg => {
      const errorCode = (msg.payload?.['errorCode'] as string | undefined) ?? 'unknown';
      const desc = (msg.payload?.['description'] as string | undefined) ?? errorCode;
      log.error('Broker ORDER_ERROR_EVENT received', { errorCode, desc, payload: msg.payload });
      this.emitOrderFailed(desc).catch(() => {});
    });
  }

  /** True only after the broker has confirmed at least one fill via EXECUTION_EVENT. */
  hasBrokerPosition(): boolean {
    return this.positionId !== null;
  }

  setSymbolId(id: number): void {
    this.symbolId = id;
    log.info('Symbol ID set', { symbolId: id });
  }

  async connect(): Promise<void> {
    await this.session.connect();
    this.logStartupVolumes();
  }

  async disconnect(): Promise<void> {
    await this.session.disconnect();
  }

  async notify(event: NotificationEvent): Promise<void> {
    switch (event.type) {
      case 'ENTRY_TRIGGERED':
        await this.onEntry(event);
        break;
      case 'BREAKEVEN_TRIGGERED':
        await this.onBreakeven(event.newStop);
        break;
      case 'POSITION_CLOSED':
        await this.onClose();
        break;
    }
  }

  // ── Private: event handlers ───────────────────────────────────────────────

  private async onEntry(event: Extract<NotificationEvent, { type: 'ENTRY_TRIGGERED' }>): Promise<void> {
    const exec = this.qsConfig.execution;
    if (!exec) return;

    if (this.symbolId === null) {
      log.error('Cannot place order — symbolId not yet resolved');
      await this.emitOrderFailed('symbolId not resolved yet');
      return;
    }

    const vol = computeVolume({
      capital:    this.qsConfig.capital.starting_capital_eur,
      riskPct:    this.qsConfig.capital.daily_risk_pct,
      allocPct:   event.allocationPct,
      stopPoints: this.qsConfig.trident.stop_loss_points,
      pointValue: exec.point_value_eur,
    });

    if (vol === 0) {
      log.error('Computed volume is 0 — skipping order', { allocPct: event.allocationPct });
      await this.emitOrderFailed('computed volume is zero');
      return;
    }

    const apiVol = vol * VOLUME_MULTIPLIER;
    const side   = event.direction === 'long' ? 'BUY' : 'SELL';

    log.info('Placing market order', {
      direction: event.direction,
      entryNumber: event.entryNumber,
      volume: vol,
      apiVolume: apiVol,
      side,
    });

    const clientMsgId = this.session.send({
      payloadType: PT.NEW_ORDER_REQ,
      payload: {
        ctidTraderAccountId: this.session.accountId,
        symbolId:            this.symbolId,
        orderType:           'MARKET',
        tradeSide:           side,
        volume:              apiVol,
      },
    });

    // Timeout: if no execution event arrives within 10s, assume the order was lost.
    const timeout = setTimeout(() => {
      this.orderTimeouts.delete(clientMsgId);
      log.error('Order timed out — no execution event received', { clientMsgId, side, apiVol });
      this.emitOrderFailed(`Entry ${event.entryNumber} ${side} order: no response from broker within 10s`).catch(() => {});
    }, 10_000);
    this.orderTimeouts.set(clientMsgId, timeout);

    // Track total volume for the eventual close request.
    this.totalVolume += apiVol;

    // Queue SL amend — position ID may not be known yet (arrives in EXECUTION_EVENT).
    this.pendingStopPrice = event.currentStop;
  }

  private async onBreakeven(newStop: number): Promise<void> {
    log.info('Breakeven triggered — amending stop', { newStop });
    this.pendingStopPrice = newStop;
    this.flushPendingStop();
  }

  private async onClose(): Promise<void> {
    if (this.positionId === null) {
      log.warn('POSITION_CLOSED but no positionId stored — no close request sent');
      this.reset();
      return;
    }

    log.info('Closing position at broker', { positionId: this.positionId, volume: this.totalVolume });

    this.session.send({
      payloadType: PT.CLOSE_POSITION_REQ,
      payload: {
        ctidTraderAccountId: this.session.accountId,
        positionId:          this.positionId,
        volume:              this.totalVolume,
      },
    });

    this.reset();
  }

  private handleExecutionEvent(payload: Record<string, unknown>): void {
    // executionType arrives as an integer from the broker:
    //   1 = ORDER_SUBMITTED, 2 = ORDER_ACCEPTED, 3 = ORDER_FILLED,
    //   4 = ORDER_REJECTED,  5 = ORDER_EXPIRED,  6 = ORDER_CANCELLED
    const execType    = payload['executionType'] as number | string | undefined;
    const position    = payload['position'] as Record<string, unknown> | undefined;
    const order       = payload['order']    as Record<string, unknown> | undefined;
    const clientMsgId = (order?.['clientOrderId'] ?? order?.['clientMsgId'] ?? payload['clientMsgId']) as string | undefined;

    // Always log at INFO so broker responses are visible even without DEBUG mode.
    log.info('EXECUTION_EVENT received', {
      executionType: execType,
      clientMsgId,
      positionId: position?.['positionId'],
      orderStatus: order?.['orderStatus'],
      rejectReason: order?.['rejectReason'] ?? payload['rejectReason'],
    });

    // Clear the order timeout for this clientMsgId if present.
    if (clientMsgId && this.orderTimeouts.has(clientMsgId)) {
      clearTimeout(this.orderTimeouts.get(clientMsgId));
      this.orderTimeouts.delete(clientMsgId);
    }

    const isRejected = execType === 4 || execType === 'ORDER_REJECTED' || execType === 'ORDER_CANCEL_REJECT';
    if (isRejected) {
      const rejectReason = (order?.['rejectReason'] ?? payload['rejectReason'] ?? 'unknown') as string;
      const desc = `order rejected: ${rejectReason}`;
      log.error('Order rejected by broker', { executionType: execType, rejectReason, payload });
      this.emitOrderFailed(desc).catch(() => {});
      return;
    }

    // POSITION_OPENED and ORDER_FILLED confirm a fill. POSITION_CHANGED can also confirm a fill
    // if it includes a position object, but it can also fire for non-fill events (e.g., SL amendment).
    // Only treat it as a fill if it has a position object.
    const isFilled = (execType === 3 || execType === 'ORDER_FILLED' || execType === 'POSITION_OPENED') ||
                     (execType === 'POSITION_CHANGED' && position != null);
    if (isFilled) {
      const pid = position?.['positionId'] as number | undefined;
      if (pid != null) {
        log.info('Position fill confirmed', { positionId: pid, executionType: execType });
        this.positionId = pid;
        // Flush any pending stop-loss amendments. If breakeven fired before this fill,
        // its stop price was queued in pendingStopPrice and will now be sent.
        this.flushPendingStop();
      }
      return;
    }

    // executionType 2 = ORDER_ACCEPTED (order sent, waiting for fill). Just log and continue.
    if (execType === 2 || execType === 'ORDER_ACCEPTED') {
      log.debug('Order accepted by broker, waiting for fill', { clientMsgId, positionId: position?.['positionId'] });
      return;
    }

    // Log any other execution type we don't explicitly handle.
    log.warn('Unhandled EXECUTION_EVENT type', { executionType: execType, payload });
  }

  private flushPendingStop(): void {
    if (this.pendingStopPrice === null || this.positionId === null) return;

    const stopPrice = this.pendingStopPrice;
    this.pendingStopPrice = null;

    log.info('Amending stop-loss on position', { positionId: this.positionId, stopPrice });

    this.session.send({
      payloadType: PT.AMEND_POSITION_SLTP_REQ,
      payload: {
        ctidTraderAccountId: this.session.accountId,
        positionId:          this.positionId,
        stopLoss:            stopPrice,
      },
    });
  }

  private reset(): void {
    this.positionId       = null;
    this.totalVolume      = 0;
    this.pendingStopPrice = null;
    for (const t of this.orderTimeouts.values()) clearTimeout(t);
    this.orderTimeouts.clear();
  }

  private logStartupVolumes(): void {
    const exec = this.qsConfig.execution;
    if (!exec) return;

    const tiers = [
      { label: 'Entry 1', alloc: this.qsConfig.trident.entry_1_allocation_pct },
      { label: 'Entry 2', alloc: this.qsConfig.trident.entry_2_allocation_pct },
      { label: 'Entry 3', alloc: this.qsConfig.trident.entry_3_allocation_pct },
    ];

    for (const tier of tiers) {
      const vol = computeVolume({
        capital:    this.qsConfig.capital.starting_capital_eur,
        riskPct:    this.qsConfig.capital.daily_risk_pct,
        allocPct:   tier.alloc,
        stopPoints: this.qsConfig.trident.stop_loss_points,
        pointValue: exec.point_value_eur,
      });
      log.info('Startup volume check', {
        tier: tier.label,
        allocPct: tier.alloc,
        lots: vol,
        apiVolume: vol * VOLUME_MULTIPLIER,
      });
    }
  }

  // Notify the MultiNotifier chain of a failed order. Importing MultiNotifier
  // here would create a circular dependency, so we fire-and-forget via the
  // session's own error path instead. In practice the WebSocketNotifier will
  // surface ORDER_FAILED events routed through the MultiNotifier in index.ts.
  //
  // The executor itself cannot call notifier.notify() because it IS a notifier.
  // index.ts wires the MultiNotifier with the executor as a child, not the other
  // way around. ORDER_FAILED events are emitted by bubbling up through a
  // separate callback that index.ts provides.
  private orderFailedCallback: ((reason: string, orderId?: string) => void) | null = null;

  setOrderFailedCallback(cb: (reason: string, orderId?: string) => void): void {
    this.orderFailedCallback = cb;
  }

  private async emitOrderFailed(reason: string, orderId?: string): Promise<void> {
    log.error('ORDER_FAILED', { reason, orderId });
    this.orderFailedCallback?.(reason, orderId);
  }
}
