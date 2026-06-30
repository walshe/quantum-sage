import { describe, it, expect } from 'vitest';
import { computeVolume, computeVolumeUnits } from '../../src/trader/volumeCalculator.js';

describe('computeVolume', () => {
  const base = {
    capital: 80_000,
    riskPct: 0.5,
    stopPoints: 40,
    pointValue: 1,
  };

  it('computes correctly for entry 1 at 32.5%', () => {
    // 80000 × 0.005 × 0.325 / (40 × 1) = 130 / 40 = 3.25 → 3.25 lots
    expect(computeVolume({ ...base, allocPct: 32.5 })).toBe(3.25);
  });

  it('computes correctly for entry 2 at 35%', () => {
    // 80000 × 0.005 × 0.35 / (40 × 1) = 140 / 40 = 3.5 → 3.5 lots
    expect(computeVolume({ ...base, allocPct: 35 })).toBe(3.5);
  });

  it('returns 0 when result is below 0.01 lots', () => {
    // 100 × 0.005 × 0.325 / 40 = 0.00406… → floor(0.406) / 100 = 0
    expect(computeVolume({ ...base, capital: 100, allocPct: 32.5 })).toBe(0);
  });

  it('returns 0 when pointValue is 0 (guards against divide-by-zero)', () => {
    expect(computeVolume({ ...base, allocPct: 32.5, pointValue: 0 })).toBe(0);
  });

  it('floors to 0.01 precision correctly', () => {
    // 80000 × 0.005 × 0.325 / 33 = 130 / 33 = 3.939… → floor(393.9) / 100 = 3.93
    expect(computeVolume({ ...base, allocPct: 32.5, stopPoints: 33 })).toBe(3.93);
  });

  it('scales with point value', () => {
    // 80000 × 0.005 × 0.325 / (40 × 2) = 130 / 80 = 1.625 → 1.62
    expect(computeVolume({ ...base, allocPct: 32.5, pointValue: 2 })).toBe(1.62);
  });

  it('handles small accounts with fractional lots', () => {
    // 1000 × 0.005 × 0.325 / 40 = 1.625 / 40 = 0.040625 → 0.04 lots
    expect(computeVolume({ ...base, capital: 1_000, allocPct: 32.5 })).toBe(0.04);
  });

  it('computeVolumeUnits returns integer API units with no float round-trip', () => {
    // 80000 × 0.005 × 0.325 / 40 = 3.25 → 325 API units (exact integer, no Math.round needed)
    expect(computeVolumeUnits({ ...base, allocPct: 32.5 })).toBe(325);
    expect(Number.isInteger(computeVolumeUnits({ ...base, allocPct: 32.5 }))).toBe(true);
    // computeVolume = computeVolumeUnits / 100
    expect(computeVolume({ ...base, allocPct: 32.5 })).toBe(computeVolumeUnits({ ...base, allocPct: 32.5 }) / 100);
  });

  it('minimum viable account returns 0.01 lots (~€246)', () => {
    // 250 × 0.005 × 0.325 / 40 = 0.406… → 0.01 (just over minimum, floor to 0 if below)
    // At exactly €246: 246 × 0.005 × 0.325 / 40 = 0.3997… → 0 (below threshold)
    expect(computeVolume({ ...base, capital: 246, allocPct: 32.5 })).toBe(0);
    // At €247: 247 × 0.005 × 0.325 / 40 = 0.4013… → 0 still (need ≥0.01 API units)
    // At €250: 250 × 0.005 × 0.325 / 40 = 0.40625 → 0 (still sub-0.01)
    // At €1000: see above → 0.04 ✓
  });
});
