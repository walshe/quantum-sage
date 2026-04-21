import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildSnapshot,
  clearSnapshot,
  loadSnapshot,
  saveSnapshot,
  type EngineSnapshot,
} from '../src/strategy/persistence.js';
import { TridentEngine } from '../src/strategy/TridentEngine.js';
import { ConsoleNotifier } from '../src/notifier/ConsoleNotifier.js';
import type { QSConfig } from '../src/config/types.js';
import type { SignalFile } from '../src/signal/types.js';
import type { ActivePosition } from '../src/strategy/types.js';

const TODAY = new Date().toISOString().slice(0, 10);
const NOW_TIME = new Date().toTimeString().slice(0, 5);

const config: QSConfig = {
  capital: { starting_capital_eur: 80000, daily_risk_pct: 0.5, soft_daily_stop_eur: 400, hard_daily_stop_eur: 800 },
  trident: {
    entry_1_allocation_pct: 32.5,
    entry_2_allocation_pct: 35.0,
    entry_3_allocation_pct: 32.5,
    midpoint_offset_buy: 2,
    midpoint_offset_sell: -2,
    stop_loss_points: 40,
    breakeven_trigger_points: 25,
    hard_profit_exit_points: 33,
    time_exit_minutes: 180,
    dvs_gate: 75,
  },
  size_adaptation: { after_one_loss_day: 0.5, after_two_loss_days: 0.25 },
  signal: { watch_dir: './signals', stale_threshold_hours: 6, vwap_staleness_warn_minutes: 90 },
};

function makeSignal(): SignalFile {
  return {
    schema_version: '1.0',
    meta: {
      date: TODAY,
      timestamp: NOW_TIME,
      update_seq: 1,
      contract: 'ESM6',
      futures_last: 6578.67,
      cash_last: 6535.67,
      basis: 43.00,
      execution_instrument: 'ES',
    },
    volatility: { dvs: 61.34, dvs_prior: 49.33, skew: 145.45, regime: 'normal' },
    vwap: { value: 6555.00, updated_at: NOW_TIME, source: 'manual' },
    ranges: { range_1_up: 6680.25, range_2_up: 6647.25, range_2_down: 6542.75, range_1_down: 6509.75 },
    levels: {
      level_time: NOW_TIME,
      max_sell_1: 6616.00,
      max_sell_2: 6582.00,
      max_buy_1: null,
      max_buy_2: 6467.00,
      supporto: 6500.00,
      resistenza: null,
      additional: [],
    },
    levels_recal: {
      level_time: null,
      max_sell_1: null, max_sell_2: null, max_buy_1: null, max_buy_2: null,
      supporto: null, resistenza: null, additional: [],
    },
    // neutral so the engine picks the short side (both MAX SELL levels are present)
    bias: { direction: 'neutral', confidence: 'medium' },
    invalidation: { void_above: 6700.00, void_below: 6430.00, expiry: '23:59' },
  };
}

let tmp: string;
let snapshotPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'trident-persist-'));
  snapshotPath = join(tmp, 'engine-state.json');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('persistence — unit', () => {
  it('round-trips a snapshot with Date fields preserved', () => {
    const filledAt = new Date('2026-04-21T09:30:00.000Z');
    const position: ActivePosition = {
      direction: 'short',
      fills: [{ entryNumber: 1, price: 6582, allocationPct: 32.5, filledAt }],
      pendingEntries: [
        { entryNumber: 2, price: 6597, allocationPct: 35.0 },
        { entryNumber: 3, price: 6616, allocationPct: 32.5 },
      ],
      avgEntry: 6582,
      currentStop: 6622,
      vwapTarget: 6555,
      lastFillTime: filledAt,
      breakEvenActive: false,
    };

    saveSnapshot(snapshotPath, buildSnapshot({
      state: 'in_trade',
      dailyLocked: false,
      currentSignal: makeSignal(),
      signalFilePath: '/tmp/qs_signal_test.yaml',
      activeLevels: {
        level_time: NOW_TIME,
        max_sell_1: 6616, max_sell_2: 6582, max_buy_1: null, max_buy_2: 6467,
      },
      tradeSetup: [
        { entryNumber: 1, price: 6582, allocationPct: 32.5 },
        { entryNumber: 2, price: 6597, allocationPct: 35.0 },
        { entryNumber: 3, price: 6616, allocationPct: 32.5 },
      ],
      position,
    }));

    const restored = loadSnapshot(snapshotPath);
    expect(restored).not.toBeNull();
    expect(restored!.state).toBe('in_trade');
    expect(restored!.position!.fills[0].filledAt).toBeInstanceOf(Date);
    expect(restored!.position!.fills[0].filledAt.toISOString()).toBe(filledAt.toISOString());
    expect(restored!.position!.lastFillTime).toBeInstanceOf(Date);
    expect(restored!.position!.avgEntry).toBe(6582);
    expect(restored!.signalFilePath).toBe('/tmp/qs_signal_test.yaml');
  });

  it('returns null when snapshot file does not exist', () => {
    expect(loadSnapshot(snapshotPath)).toBeNull();
  });

  it('returns null when snapshot is from a previous calendar day', () => {
    const stale: EngineSnapshot = {
      version: 1,
      savedAt: '2020-01-01T00:00:00.000Z',
      date: '2020-01-01',
      state: 'in_trade',
      dailyLocked: false,
      currentSignal: null,
      signalFilePath: null,
      activeLevels: null,
      tradeSetup: null,
      position: null,
    };
    writeFileSync(snapshotPath, JSON.stringify(stale), 'utf8');
    expect(loadSnapshot(snapshotPath)).toBeNull();
  });

  it('returns null on version mismatch', () => {
    const bad = { version: 999, date: TODAY, savedAt: new Date().toISOString(), state: 'idle' };
    writeFileSync(snapshotPath, JSON.stringify(bad), 'utf8');
    expect(loadSnapshot(snapshotPath)).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    writeFileSync(snapshotPath, '{not json', 'utf8');
    expect(loadSnapshot(snapshotPath)).toBeNull();
  });

  it('atomic write leaves no .tmp file on success', () => {
    saveSnapshot(snapshotPath, buildSnapshot({
      state: 'idle',
      dailyLocked: false,
      currentSignal: null,
      signalFilePath: null,
      activeLevels: null,
      tradeSetup: null,
      position: null,
    }));
    expect(existsSync(snapshotPath)).toBe(true);
    expect(existsSync(`${snapshotPath}.tmp`)).toBe(false);
  });

  it('clearSnapshot removes the file and is idempotent', () => {
    writeFileSync(snapshotPath, '{}', 'utf8');
    clearSnapshot(snapshotPath);
    expect(existsSync(snapshotPath)).toBe(false);
    // second call on a missing file should not throw
    expect(() => clearSnapshot(snapshotPath)).not.toThrow();
  });
});

describe('persistence — engine hydration', () => {
  it('restores position, state, and daily lock across engine instances', async () => {
    const notifier = new ConsoleNotifier(false);

    const engineA = new TridentEngine(config, notifier, { snapshotPath });
    await engineA.loadSignal(makeSignal(), '/tmp/qs_signal_test.yaml');
    expect(engineA.getState()).toBe('watching');

    // Fire a price past MAX SELL 2 to trigger Entry 1 on the short side.
    await engineA.onPriceUpdate(6582.5);
    expect(engineA.getState()).toBe('in_trade');
    const posA = engineA.getPosition();
    expect(posA).not.toBeNull();

    // Simulate a crash + restart: construct a fresh engine pointing at the same file.
    const engineB = new TridentEngine(config, notifier, { snapshotPath });
    expect(engineB.getState()).toBe('in_trade');
    const posB = engineB.getPosition();
    expect(posB).not.toBeNull();
    expect(posB!.direction).toBe(posA!.direction);
    expect(posB!.avgEntry).toBe(posA!.avgEntry);
    expect(posB!.currentStop).toBe(posA!.currentStop);
    expect(posB!.fills.length).toBe(posA!.fills.length);
    expect(posB!.fills[0].filledAt).toBeInstanceOf(Date);
  });

  it('ignores snapshots from a prior calendar day (fresh start for new day)', () => {
    const stale: EngineSnapshot = {
      version: 1,
      savedAt: '2020-01-01T00:00:00.000Z',
      date: '2020-01-01',
      state: 'in_trade',
      dailyLocked: true,
      currentSignal: null,
      signalFilePath: null,
      activeLevels: null,
      tradeSetup: null,
      position: null,
    };
    writeFileSync(snapshotPath, JSON.stringify(stale), 'utf8');

    const engine = new TridentEngine(config, new ConsoleNotifier(false), { snapshotPath });
    expect(engine.getState()).toBe('idle');
    expect(engine.isLockedForDay()).toBe(false);
  });

  it('persistence can be disabled by passing snapshotPath: null', async () => {
    const engine = new TridentEngine(config, new ConsoleNotifier(false), { snapshotPath: null });
    await engine.loadSignal(makeSignal(), '/tmp/qs_signal_test.yaml');
    await engine.onPriceUpdate(6582.5);
    expect(existsSync(snapshotPath)).toBe(false);
  });
});
