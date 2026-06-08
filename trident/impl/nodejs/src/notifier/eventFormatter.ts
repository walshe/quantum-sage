import { basename } from 'path';
import type { NotificationEvent } from './Notifier.js';
import { isActionRequired } from './Notifier.js';

/**
 * Structured, channel-agnostic form of a NotificationEvent.
 * ConsoleNotifier renders this as indented text; WebSocketNotifier sends it
 * as a JSON envelope to the browser. Keeping both on this shared shape stops
 * the two from drifting apart.
 */
export interface FormattedEvent {
  /** HH:MM:SS in the server's local timezone — used by the ConsoleNotifier. */
  timestamp: string;
  /**
   * ISO 8601 UTC string for the same instant.
   * The browser dashboard uses this to display the time in the analyst's
   * local timezone (with a timezone abbreviation label), avoiding confusion
   * when the server and analyst are in different time zones.
   */
  isoTimestamp: string;
  type: NotificationEvent['type'];
  tag: string;                          // short label: "SIGNAL", "ENTRY 1", "CLOSED WIN", ...
  headline: string;                     // first line, excluding timestamp + tag
  detail: string[];                     // subsequent indented lines
  action: string | null;                // broker-action text when actionRequired, else null
  severity: 'info' | 'warn' | 'error';
  actionRequired: boolean;
}

/**
 * Public entry point — adds `isoTimestamp` (UTC) alongside the server-local
 * `timestamp` so the browser can reformat to the analyst's local timezone.
 */
export function formatEvent(event: NotificationEvent, now: Date = new Date()): FormattedEvent {
  return { ...formatEventCore(event, now), isoTimestamp: now.toISOString() };
}

function formatEventCore(
  event: NotificationEvent,
  now: Date = new Date(),
): Omit<FormattedEvent, 'isoTimestamp'> {
  const timestamp = now.toTimeString().slice(0, 8);
  const actionRequired = isActionRequired(event);

  switch (event.type) {
    case 'SIGNAL_LOADED':
      return {
        timestamp, type: event.type, tag: 'SIGNAL',
        headline: `📋 Loaded ${basename(event.filePath)}`,
        detail: [
          `Date: ${event.signal.meta.date} | DVS: ${event.signal.volatility.dvs} (${event.signal.volatility.regime}) | VWAP: ${event.signal.vwap.value}`,
        ],
        action: null, severity: 'info', actionRequired,
      };

    case 'SIGNAL_INVALID':
      return {
        timestamp, type: event.type, tag: 'INVALID',
        headline: basename(event.filePath),
        detail: event.errors.map(e => `✗ ${e}`),
        action: null, severity: 'error', actionRequired,
      };

    case 'SIGNAL_WARNING':
      return {
        timestamp, type: event.type, tag: 'WARN',
        headline: basename(event.filePath),
        detail: event.warnings.map(w => `⚠ ${w}`),
        action: null, severity: 'warn', actionRequired,
      };

    case 'DVS_GATE_BLOCKED':
      return {
        timestamp, type: event.type, tag: 'DVS GATE',
        headline: `🚫 NO TRADES TODAY — DVS ${event.dvs} exceeds gate ${event.gate}`,
        detail: [], action: null, severity: 'info', actionRequired,
      };

    case 'NO_TRADE_SETUP':
      return {
        timestamp, type: event.type, tag: 'NO SETUP',
        headline: event.reason,
        detail: [], action: null, severity: 'info', actionRequired,
      };

    case 'SETUP_READY': {
      // Two-sided watching: neutral bias with both level pairs active.
      if (event.bias === 'neutral' && event.altDirection && event.altEntries) {
        const longEntries  = event.direction === 'long'  ? event.entries    : event.altEntries;
        const shortEntries = event.direction === 'short' ? event.entries    : event.altEntries;
        const longEntry1  = longEntries.find(e => e.entryNumber === 1);
        const shortEntry1 = shortEntries.find(e => e.entryNumber === 1);
        return {
          timestamp, type: event.type, tag: 'SETUP',
          headline: `👀 Watching both sides — ⬆️ LONG Entry 1 @ ${fmt(longEntry1?.price ?? 0)}  OR  ⬇️ SHORT Entry 1 @ ${fmt(shortEntry1?.price ?? 0)} — first trigger wins`,
          detail: [
            `⬆️ Long chain:  ${longEntries.map(e => `${fmt(e.price)} (${e.allocationPct}%)`).join(' → ')}`,
            `⬇️ Short chain: ${shortEntries.map(e => `${fmt(e.price)} (${e.allocationPct}%)`).join(' → ')}`,
            `🛑 Stop: ${event.stopPoints}pts from avg entry  |  🎯 Target: VWAP @ ${fmt(event.vwap)}`,
          ],
          action: null, severity: 'info', actionRequired,
        };
      }

      // Single-sided watching.
      const dir = event.direction.toUpperCase();
      const arrow = event.direction === 'long' ? '⬆️' : '⬇️';
      const entry1 = event.entries.find(e => e.entryNumber === 1);
      const biasLabel = event.bias === 'long'    ? 'bias: long'
                      : event.bias === 'short'   ? 'bias: short'
                      : event.bias === 'neutral' ? 'bias: neutral'
                      :                            'no bias set — defaulting to long';
      const entryLines = event.entries.map(
        e => `Entry ${e.entryNumber}: ${fmt(e.price)} (${e.allocationPct}%)`
      );
      return {
        timestamp, type: event.type, tag: 'SETUP',
        headline: `👀 Watching for ${dir} entry ${arrow} — Entry 1 triggers @ ${fmt(entry1?.price ?? 0)} (${biasLabel})`,
        detail: [
          ...entryLines,
          `🛑 Stop: ${event.stopPoints}pts from avg entry  |  🎯 Target: VWAP @ ${fmt(event.vwap)}`,
        ],
        action: null, severity: 'info', actionRequired,
      };
    }

    case 'ENTRY_TRIGGERED': {
      const dir = event.direction.toUpperCase();
      const dot = event.direction === 'long' ? '🟢' : '🔴';
      const verb = event.entryNumber === 1 ? 'Open' : 'Scale into';
      return {
        timestamp, type: event.type, tag: `ENTRY ${event.entryNumber}`,
        headline: `${dot} ${dir} @ ${fmt(event.price)} (${event.allocationPct}%)`,
        detail: [
          `Avg entry: ${fmt(event.avgEntry)} | 🛑 Stop: ${fmt(event.currentStop)} | Fills remaining: ${event.fillsRemaining}`,
        ],
        action: `${dot} ${verb} ${dir} at broker (${event.allocationPct}% size). Set stop @ ${fmt(event.currentStop)}.`,
        severity: 'info', actionRequired,
      };
    }

    case 'BREAKEVEN_TRIGGERED':
      return {
        timestamp, type: event.type, tag: 'BREAKEVEN',
        headline: `🛡️ Stop moved to ${fmt(event.newStop)} (avg entry)`,
        detail: [],
        action: `🛡️ Move stop at broker to ${fmt(event.newStop)}. Cancel any unfilled entry orders.`,
        severity: 'info', actionRequired,
      };

    case 'POSITION_CLOSED': {
      const sign = event.pnlPoints >= 0 ? '+' : '';
      const label = event.pnlPoints >= 0 ? 'WIN ' : 'LOSS';
      const icon = event.pnlPoints >= 0 ? '💰' : '📉';
      const dir = event.direction.toUpperCase();
      return {
        timestamp, type: event.type, tag: `CLOSED ${label}`,
        headline: `${icon} ${dir} closed @ ${fmt(event.closePrice)} — ${sign}${event.pnlPoints.toFixed(2)} pts (${event.reason})`,
        detail: [],
        action: `${icon} Close ${dir} position at broker now (reason: ${event.reason}).`,
        severity: 'info', actionRequired,
      };
    }

    case 'DAILY_LOCK':
      return {
        timestamp, type: event.type, tag: 'LOCK',
        headline: `🔒 No more trades today — ${event.reason}`,
        detail: [], action: null, severity: 'info', actionRequired,
      };

    case 'PRICE_UPDATE':
      return {
        timestamp, type: event.type, tag: 'PRICE',
        headline: fmt(event.price),
        detail: [], action: null, severity: 'info', actionRequired,
      };

    case 'ENGINE_ERROR':
      return {
        timestamp, type: event.type, tag: 'ERROR',
        headline: event.message,
        detail: [], action: null, severity: 'error', actionRequired,
      };

    case 'ACCOUNT_UPDATE':
      return {
        timestamp, type: event.type, tag: 'ACCOUNT',
        headline: `Balance: ${event.currency} ${event.balance.toFixed(2)}`,
        detail: [], action: null, severity: 'info', actionRequired,
      };

    case 'ORDER_FAILED':
      return {
        timestamp, type: event.type, tag: 'ORDER ERR',
        headline: `⚠️ Order failed — ${event.reason}`,
        detail: event.orderId ? [`Order ID: ${event.orderId}`] : [],
        action: '⚠️ Check broker position manually — automated order was not placed.',
        severity: 'error', actionRequired: true,
      };
  }
}

function fmt(price: number): string {
  return price.toFixed(2);
}
