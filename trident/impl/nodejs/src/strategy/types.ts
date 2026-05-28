export type Direction = 'long' | 'short';

export type CloseReason =
  | 'stop_loss'
  | 'vwap_hit'
  | 'hard_profit_exit'
  | 'time_exit';

export interface EntryLevel {
  entryNumber: 1 | 2 | 3;
  price: number;
  allocationPct: number;
}

/** A confirmed fill — one of the three entries was executed. */
export interface Fill {
  entryNumber: 1 | 2 | 3;
  price: number;
  allocationPct: number;
  filledAt: Date;
}

export type PositionState =
  | 'idle'          // no signal loaded, nothing to do
  | 'blocked'       // DVS gate or daily lock active
  | 'watching'      // signal loaded, waiting for Entry 1
  | 'in_trade'      // at least Entry 1 is filled
  | 'closed';       // trade is done for today

export interface ActivePosition {
  direction: Direction;
  fills: Fill[];
  /** Pending entries not yet triggered (entryNumber 1, 2, or 3). */
  pendingEntries: EntryLevel[];
  avgEntry: number;
  currentStop: number;
  vwapTarget: number;
  lastFillTime: Date;
  breakEvenActive: boolean;
}
