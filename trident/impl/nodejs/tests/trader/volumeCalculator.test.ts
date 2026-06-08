import { describe, it, expect } from 'vitest';
import { computeVolume } from '../../src/trader/volumeCalculator.js';

describe('computeVolume', () => {
  const base = {
    capital: 80_000,
    riskPct: 0.5,
    stopPoints: 40,
    pointValue: 1,
  };

  it('computes correctly for entry 1 at 32.5%', () => {
    // 80000 × 0.005 × 0.325 / (40 × 1) = 130 / 40 = 3.25 → floor = 3
    expect(computeVolume({ ...base, allocPct: 32.5 })).toBe(3);
  });

  it('computes correctly for entry 2 at 35%', () => {
    // 80000 × 0.005 × 0.35 / (40 × 1) = 140 / 40 = 3.5 → floor = 3
    expect(computeVolume({ ...base, allocPct: 35 })).toBe(3);
  });

  it('returns 0 when result is below 1 lot', () => {
    // tiny capital — vol would be 0.something
    expect(computeVolume({ ...base, capital: 100, allocPct: 32.5 })).toBe(0);
  });

  it('returns 0 when pointValue is 0 (guards against divide-by-zero)', () => {
    expect(computeVolume({ ...base, allocPct: 32.5, pointValue: 0 })).toBe(0);
  });

  it('floors correctly when result is not an integer', () => {
    // 80000 × 0.005 × 0.325 = 130; 130 / 33 = 3.93… → floor = 3
    expect(computeVolume({ ...base, allocPct: 32.5, stopPoints: 33 })).toBe(3);
  });

  it('scales with point value', () => {
    // With pointValue 2: 80000 × 0.005 × 0.325 / (40 × 2) = 130 / 80 = 1.625 → 1
    expect(computeVolume({ ...base, allocPct: 32.5, pointValue: 2 })).toBe(1);
  });
});
