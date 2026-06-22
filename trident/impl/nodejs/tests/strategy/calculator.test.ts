import { describe, it, expect } from 'vitest';
import {
  calculateEntries,
  calculateAvgEntry,
  calculateStop,
  pnlPoints,
  isEntryTriggered,
  isStopHit,
  isVwapHit,
} from '../../src/strategy/calculator.js';
import type { QSConfig } from '../../src/config/types.js';

const config: QSConfig = {
  capital: { daily_risk_pct: 0.5 },
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

describe('calculateEntries', () => {
  it('computes the correct long entries from the PRD example', () => {
    // PRD Section 7.4: BUY INNER = 6467, BUY OUTER = 6440
    const entries = calculateEntries('long', 6467, 6440, config);

    expect(entries[0]).toMatchObject({ entryNumber: 1, price: 6467, allocationPct: 32.5 });
    // Midpoint = (6467 + 6440) / 2 + 2 = 6453.5 + 2 = 6455.5
    expect(entries[1]).toMatchObject({ entryNumber: 2, price: 6455.5, allocationPct: 35.0 });
    expect(entries[2]).toMatchObject({ entryNumber: 3, price: 6440, allocationPct: 32.5 });
  });

  it('applies negative midpoint offset for short entries', () => {
    // SELL INNER = 6582, SELL OUTER = 6616
    const entries = calculateEntries('short', 6582, 6616, config);

    expect(entries[0]).toMatchObject({ entryNumber: 1, price: 6582 });
    // Midpoint = (6582 + 6616) / 2 - 2 = 6599 - 2 = 6597
    expect(entries[1].price).toBeCloseTo(6597, 5);
    expect(entries[2]).toMatchObject({ entryNumber: 3, price: 6616 });
  });
});

describe('calculateAvgEntry', () => {
  it('weights entries correctly when only Entry 1 is filled', () => {
    const avg = calculateAvgEntry([{ price: 6467, allocationPct: 32.5 }]);
    expect(avg).toBe(6467);
  });

  it('weights entries correctly when all three are filled', () => {
    const avg = calculateAvgEntry([
      { price: 6467.00, allocationPct: 32.5 },
      { price: 6455.50, allocationPct: 35.0 },
      { price: 6440.00, allocationPct: 32.5 },
    ]);
    // (6467*32.5 + 6455.5*35 + 6440*32.5) / 100
    const expected = (6467 * 32.5 + 6455.5 * 35 + 6440 * 32.5) / 100;
    expect(avg).toBeCloseTo(expected, 5);
  });
});

describe('calculateStop', () => {
  it('places stop 40 pts below avg entry for longs', () => {
    expect(calculateStop('long', 6467, 40)).toBe(6427);
  });

  it('places stop 40 pts above avg entry for shorts', () => {
    expect(calculateStop('short', 6582, 40)).toBe(6622);
  });
});

describe('pnlPoints', () => {
  it('returns positive pnl when long trade moves up', () => {
    expect(pnlPoints('long', 6467, 6492)).toBeCloseTo(25);
  });

  it('returns negative pnl when long trade moves down', () => {
    expect(pnlPoints('long', 6467, 6427)).toBeCloseTo(-40);
  });

  it('returns positive pnl when short trade moves down', () => {
    expect(pnlPoints('short', 6582, 6557)).toBeCloseTo(25);
  });
});

describe('isEntryTriggered', () => {
  it('triggers long entry when price falls to the level', () => {
    expect(isEntryTriggered('long', 6467, 6467)).toBe(true);
    expect(isEntryTriggered('long', 6467, 6466)).toBe(true);
    expect(isEntryTriggered('long', 6467, 6468)).toBe(false);
  });

  it('triggers short entry when price rises to the level', () => {
    expect(isEntryTriggered('short', 6582, 6582)).toBe(true);
    expect(isEntryTriggered('short', 6582, 6583)).toBe(true);
    expect(isEntryTriggered('short', 6582, 6581)).toBe(false);
  });
});

describe('isStopHit / isVwapHit', () => {
  it('detects stop hit for long', () => {
    expect(isStopHit('long', 6427, 6427)).toBe(true);
    expect(isStopHit('long', 6427, 6428)).toBe(false);
  });

  it('detects stop hit for short', () => {
    expect(isStopHit('short', 6622, 6622)).toBe(true);
    expect(isStopHit('short', 6622, 6621)).toBe(false);
  });

  it('detects VWAP hit for long', () => {
    expect(isVwapHit('long', 6555, 6555)).toBe(true);
    expect(isVwapHit('long', 6555, 6554)).toBe(false);
  });

  it('detects VWAP hit for short', () => {
    expect(isVwapHit('short', 6555, 6555)).toBe(true);
    expect(isVwapHit('short', 6555, 6556)).toBe(false);
  });
});
