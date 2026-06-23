export interface VolumeParams {
  /** Account capital in EUR. */
  capital: number;
  /** Daily risk as a percentage (e.g. 0.5 for 0.5%). */
  riskPct: number;
  /** Entry allocation as a percentage (e.g. 32.5 for 32.5%). */
  allocPct: number;
  /** Stop distance in index points (e.g. 40). */
  stopPoints: number;
  /** EUR value per index point per lot for the instrument (e.g. 1 for US500.cash). */
  pointValue: number;
}

/**
 * Compute lot size for a single entry tier, rounded down to 0.01 lot precision.
 *
 * Formula: floor((capital × riskPct/100 × allocPct/100) / (stopPoints × pointValue) × 100) / 100
 *
 * Works in integer hundredths-of-a-lot internally to avoid floating-point
 * drift (0.01 lot = 1 cTrader API unit when VOLUME_MULTIPLIER = 100).
 *
 * Returns 0 when the result is below 0.01 lots — callers must guard against
 * this and refuse to place the order. This allows accounts as small as ~€250
 * to trade with 0.01-lot granularity rather than requiring ~€25k for 1 lot.
 */
export function computeVolume(p: VolumeParams): number {
  const riskEur = p.capital * (p.riskPct / 100) * (p.allocPct / 100);
  const riskPerLot = p.stopPoints * p.pointValue;
  if (riskPerLot <= 0) return 0;
  const apiUnits = Math.floor((riskEur / riskPerLot) * 100); // integer hundredths-of-a-lot
  return apiUnits / 100;
}
