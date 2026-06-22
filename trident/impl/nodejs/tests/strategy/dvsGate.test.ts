import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TridentEngine } from '../../src/strategy/TridentEngine.js';
import { ConsoleNotifier } from '../../src/notifier/ConsoleNotifier.js';
import type { QSConfig } from '../../src/config/types.js';
import type { SignalFile } from '../../src/signal/types.js';

const TODAY = new Date().toISOString().slice(0, 10);
const NOW_TIME = new Date().toTimeString().slice(0, 5);

const config: QSConfig = {
  capital: { starting_capital_eur: 80000, daily_risk_pct: 0.5 },
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

function makeSignal(dvs: number): SignalFile {
  return {
    schema_version: '1.0',
    meta: {
      date: TODAY,
      timestamp: NOW_TIME,
      update_seq: 1,
      contract: 'ESM6',
      futures_last: 7400,
      cash_last: null,
      basis: null,
      execution_instrument: 'US500.cash',
    },
    volatility: { dvs, dvs_prior: null, skew: 152.25, regime: dvs > 75 ? 'extreme' : 'normal' },
    vwap: { value: 7435, updated_at: NOW_TIME, source: 'manual' },
    ranges: { range_1_up: 7474.75, range_2_up: 7457.50, range_2_down: 7345.50, range_1_down: 7328.25 },
    levels: {
      level_time: NOW_TIME,
      max_sell_1: 7474.75,
      max_sell_2: 7457.50,
      max_buy_1: 7328.25,
      max_buy_2: 7345.50,
      additional: [],
    },
    levels_recal: {
      level_time: null,
      max_sell_1: null, max_sell_2: null, max_buy_1: null, max_buy_2: null,
      additional: [],
    },
    bias: { direction: 'neutral' },
  };
}

let tmp: string;
let snapshotPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'trident-dvs-'));
  snapshotPath = join(tmp, 'engine-state.json');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('DVS gate — unblock on resubmit', () => {
  it('blocks when DVS exceeds gate', async () => {
    const engine = new TridentEngine(config, new ConsoleNotifier(), snapshotPath);
    await engine.loadSignal(makeSignal(76.53), 'test.yaml');
    expect(engine.getState()).toBe('blocked');
  });

  it('unblocks when resubmitted with valid DVS', async () => {
    const engine = new TridentEngine(config, new ConsoleNotifier(), snapshotPath);
    await engine.loadSignal(makeSignal(76.53), 'test.yaml');
    expect(engine.getState()).toBe('blocked');

    await engine.loadSignal(makeSignal(64.82), 'test2.yaml');
    expect(engine.getState()).toBe('watching');
  });

  it('stays blocked when resubmitted with still-high DVS', async () => {
    const engine = new TridentEngine(config, new ConsoleNotifier(), snapshotPath);
    await engine.loadSignal(makeSignal(76.53), 'test.yaml');
    expect(engine.getState()).toBe('blocked');

    await engine.loadSignal(makeSignal(80.0), 'test2.yaml');
    expect(engine.getState()).toBe('blocked');
  });

  it('daily lock prevents trading even when DVS is valid', async () => {
    const engine = new TridentEngine(config, new ConsoleNotifier(), snapshotPath);
    // Force daily lock
    (engine as unknown as { dailyLocked: boolean }).dailyLocked = true;

    await engine.loadSignal(makeSignal(64.82), 'test.yaml');
    expect(engine.getState()).toBe('idle');
  });
});
