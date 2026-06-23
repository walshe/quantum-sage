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
 * Compute the cTrader API volume units for a single entry tier.
 *
 * Returns an integer (hundredths-of-a-lot, i.e. lots × 100) that can be
 * sent directly to the API without any further multiplication or rounding.
 * This is the canonical form — no float round-trip, no inconsistency.
 *
 * Returns 0 when below 1 API unit (< 0.01 lots). Callers must guard and
 * refuse to place the order. Minimum viable account at default config ≈ €250.
 */
export function computeVolumeUnits(p: VolumeParams): number {
  const riskEur = p.capital * (p.riskPct / 100) * (p.allocPct / 100);
  const riskPerLot = p.stopPoints * p.pointValue;
  if (riskPerLot <= 0) return 0;
  return Math.floor((riskEur / riskPerLot) * 100);
}

/**
 * Convenience wrapper that returns lots at 0.01 precision (= units / 100).
 * Use for P&L calculations and logging. Use computeVolumeUnits() for the
 * API call itself to avoid any float round-trip.
 */
export function computeVolume(p: VolumeParams): number {
  return computeVolumeUnits(p) / 100;
}
