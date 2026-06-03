import type { SignalFile } from '../signal/types.js';
import type { EntryLevel, Direction, CloseReason } from '../strategy/types.js';

export interface AccountInfo {
  balance:       number;
  equity:        number;
  unrealizedPnl: number;
  currency:      string;
  login:         number;
  brokerName:    string;
  isLive:        boolean;
}

/**
 * Every significant engine event is typed here.
 * The notifier implementation decides how to present it
 * (console, Telegram, dashboard, etc.).
 */
export type NotificationEvent =
  | { type: 'SIGNAL_LOADED'; signal: SignalFile; filePath: string }
  | { type: 'SIGNAL_INVALID'; filePath: string; errors: string[] }
  | { type: 'SIGNAL_WARNING'; filePath: string; warnings: string[] }
  | { type: 'DVS_GATE_BLOCKED'; dvs: number; gate: number }
  | { type: 'NO_TRADE_SETUP'; reason: string }
  | {
      type: 'SETUP_READY';
      direction: Direction;
      /** Alt direction for two-sided (neutral bias) watching. Present only when both sides are active. */
      altDirection?: Direction;
      bias: 'long' | 'short' | 'neutral' | null;
      entries: EntryLevel[];
      /** Alt entry chain for two-sided watching. Present only when bias=neutral and both level pairs exist. */
      altEntries?: EntryLevel[];
      stopPoints: number;
      vwap: number;
    }
  | {
      type: 'ENTRY_TRIGGERED';
      entryNumber: 1 | 2 | 3;
      price: number;
      direction: Direction;
      allocationPct: number;
      avgEntry: number;
      currentStop: number;
      vwapTarget: number | null;
      fillsRemaining: number;
      /** Signal that was active when Entry 1 triggered — for original trade plan display. */
      entrySignalFilePath?: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entrySignal?: any;
    }
  | { type: 'BREAKEVEN_TRIGGERED'; newStop: number }
  | {
      type: 'POSITION_CLOSED';
      reason: CloseReason;
      direction: Direction;
      avgEntry: number;
      closePrice: number;
      pnlPoints: number;
    }
  | { type: 'DAILY_LOCK'; reason: string }
  | { type: 'PRICE_UPDATE'; price: number }
  | { type: 'ENGINE_ERROR'; message: string }
  | ({ type: 'ACCOUNT_UPDATE' } & AccountInfo);

/**
 * Output channel abstraction.
 * Implement this to send events anywhere: console, Telegram, file, webhook.
 */
export interface Notifier {
  notify(event: NotificationEvent): Promise<void>;
}

/**
 * True for events that require the analyst to place, adjust, or close an
 * order at the broker. False for informational events. Phase 1 is advisory,
 * so this flag is how the engine distinguishes "FYI" from "do something now".
 */
export function isActionRequired(event: NotificationEvent): boolean {
  return event.type === 'ENTRY_TRIGGERED'
      || event.type === 'BREAKEVEN_TRIGGERED'
      || event.type === 'POSITION_CLOSED';
}
