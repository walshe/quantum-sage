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
 * Compute integer lot count for a single entry tier.
 *
 * Formula: floor((capital × riskPct/100 × allocPct/100) / (stopPoints × pointValue))
 *
 * Returns 0 when the formula produces a value below 1 lot — callers must
 * guard against this and refuse to place the order.
 */
export function computeVolume(p: VolumeParams): number {
  const riskEur = p.capital * (p.riskPct / 100) * (p.allocPct / 100);
  const riskPerLot = p.stopPoints * p.pointValue;
  if (riskPerLot <= 0) return 0;
  return Math.floor(riskEur / riskPerLot);
}
