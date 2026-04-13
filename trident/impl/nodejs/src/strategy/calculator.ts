import type { QSConfig } from '../config/types.js';
import type { EntryLevel, Direction } from './types.js';

/**
 * Calculates the three entry levels for a Trident trade.
 *
 * For LONG:
 *   Entry 1 = max_buy_2 (inner, first touched)
 *   Entry 2 = midpoint(max_buy_2, max_buy_1) + midpointOffset
 *   Entry 3 = max_buy_1 (outer, last touched)
 *
 * For SHORT:
 *   Entry 1 = max_sell_2 (inner, first touched)
 *   Entry 2 = midpoint(max_sell_2, max_sell_1) + midpointOffset
 *   Entry 3 = max_sell_1 (outer, last touched)
 */
export function calculateEntries(
  direction: Direction,
  innerLevel: number,
  outerLevel: number,
  config: QSConfig
): EntryLevel[] {
  const { trident } = config;
  const midpointOffset =
    direction === 'long' ? trident.midpoint_offset_buy : trident.midpoint_offset_sell;

  const rawMidpoint = (innerLevel + outerLevel) / 2;
  const entry2Price = rawMidpoint + midpointOffset;

  return [
    { entryNumber: 1, price: innerLevel, allocationPct: trident.entry_1_allocation_pct },
    { entryNumber: 2, price: entry2Price, allocationPct: trident.entry_2_allocation_pct },
    { entryNumber: 3, price: outerLevel, allocationPct: trident.entry_3_allocation_pct },
  ];
}

/**
 * Calculates the weighted average entry price from all fills so far.
 */
export function calculateAvgEntry(
  fills: Array<{ price: number; allocationPct: number }>
): number {
  const totalAlloc = fills.reduce((sum, f) => sum + f.allocationPct, 0);
  const weighted = fills.reduce((sum, f) => sum + f.price * f.allocationPct, 0);
  return weighted / totalAlloc;
}

/**
 * Calculates the stop price given an average entry.
 * Stop is always placed stopPoints away from avgEntry, on the losing side.
 */
export function calculateStop(
  direction: Direction,
  avgEntry: number,
  stopPoints: number
): number {
  return direction === 'long' ? avgEntry - stopPoints : avgEntry + stopPoints;
}

/**
 * Returns the unrealised P&L in points from the current price.
 * Positive = profit, negative = loss.
 */
export function pnlPoints(direction: Direction, avgEntry: number, currentPrice: number): number {
  return direction === 'long' ? currentPrice - avgEntry : avgEntry - currentPrice;
}

/**
 * Returns true if the entry trigger has been hit for the given direction.
 * Long entries trigger when price falls to or below the entry price.
 * Short entries trigger when price rises to or above the entry price.
 */
export function isEntryTriggered(
  direction: Direction,
  entryPrice: number,
  currentPrice: number
): boolean {
  return direction === 'long' ? currentPrice <= entryPrice : currentPrice >= entryPrice;
}

/**
 * Returns true if the stop price has been hit.
 */
export function isStopHit(
  direction: Direction,
  stopPrice: number,
  currentPrice: number
): boolean {
  return direction === 'long' ? currentPrice <= stopPrice : currentPrice >= stopPrice;
}

/**
 * Returns true if VWAP has been reached.
 * Long: price rises to VWAP. Short: price falls to VWAP.
 */
export function isVwapHit(
  direction: Direction,
  vwap: number,
  currentPrice: number
): boolean {
  return direction === 'long' ? currentPrice >= vwap : currentPrice <= vwap;
}
