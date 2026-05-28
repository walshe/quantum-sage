import { describe, it, expect, beforeEach } from 'vitest';
import { validateSignal } from '../../src/signal/validator.js';
import type { SignalFile } from '../../src/signal/types.js';

const TODAY = new Date().toISOString().slice(0, 10);
const NOW_TIME = new Date().toTimeString().slice(0, 5);

function makeValidSignal(): SignalFile {
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
    volatility: {
      dvs: 61.34,
      dvs_prior: 49.33,
      skew: 145.45,
      regime: 'normal',
    },
    vwap: {
      value: 6555.00,
      updated_at: NOW_TIME,
      source: 'manual',
    },
    ranges: {
      range_1_up: 6680.25,
      range_2_up: 6647.25,
      range_2_down: 6542.75,
      range_1_down: 6509.75,
    },
    levels: {
      level_time: NOW_TIME,
      max_sell_1: 6616.00,
      max_sell_2: 6582.00,
      max_buy_1: null,
      max_buy_2: 6467.00,
      additional: [],
    },
    levels_recal: {
      level_time: null,
      max_sell_1: null,
      max_sell_2: null,
      max_buy_1: null,
      max_buy_2: null,
      additional: [],
    },
    bias: {
      direction: 'long',
    },
  };
}

const opts = { staleThresholdHours: 6, vwapStalenessWarnMinutes: 90 };

describe('validateSignal', () => {
  it('passes a valid signal', () => {
    const result = validateSignal(makeValidSignal(), opts);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects wrong schema_version', () => {
    const s = makeValidSignal();
    s.schema_version = '2.0';
    const result = validateSignal(s, opts);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/schema_version/);
  });

  it('rejects invalid range ordering', () => {
    const s = makeValidSignal();
    s.ranges.range_1_down = 6600; // now greater than range_2_down
    const result = validateSignal(s, opts);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Range ordering'))).toBe(true);
  });

  it('rejects invalid sell level ordering', () => {
    const s = makeValidSignal();
    s.levels.max_sell_1 = 6580; // inner < outer violated
    s.levels.max_sell_2 = 6600;
    const result = validateSignal(s, opts);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Sell level ordering'))).toBe(true);
  });

  it('rejects DVS above 200', () => {
    const s = makeValidSignal();
    s.volatility.dvs = 250;
    const result = validateSignal(s, opts);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('dvs'))).toBe(true);
  });

  it('passes when cash_last and basis are null (optional fields)', () => {
    const s = makeValidSignal();
    s.meta.cash_last = null;
    s.meta.basis = null;
    const result = validateSignal(s, opts);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('passes when dvs_prior is null (optional field)', () => {
    const s = makeValidSignal();
    s.volatility.dvs_prior = null;
    const result = validateSignal(s, opts);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('still rejects basis math mismatch when both fields are present', () => {
    const s = makeValidSignal();
    s.meta.basis = 10; // actual spread is ~43, mismatch > 5 — cash_last is still set
    const result = validateSignal(s, opts);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Basis math'))).toBe(true);
  });

  it('warns on stale VWAP but does not fail', () => {
    const s = makeValidSignal();
    // Compute a time guaranteed to be more than the warn threshold in the past.
    // Using a fixed string like '07:00' breaks when tests run within 90 min of that time.
    const staleAt = new Date(Date.now() - (opts.vwapStalenessWarnMinutes + 10) * 60_000);
    const staleIsToday = staleAt.toISOString().slice(0, 10) === TODAY;
    // If the stale time crossed midnight (edge case before ~1:40 AM), '00:01' is always
    // > 90 min old after 1:31 AM — a safe assumption for any realistic test run.
    s.vwap.updated_at = staleIsToday ? staleAt.toTimeString().slice(0, 5) : '00:01';
    const result = validateSignal(s, opts);
    expect(result.warnings.some(w => w.includes('VWAP'))).toBe(true);
    expect(result.valid).toBe(true); // staleness is a warning, not a rejection
  });
});
