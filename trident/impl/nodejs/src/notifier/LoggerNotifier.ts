import { basename } from 'path';
import { getLogger } from '../logger.js';
import type { Notifier, NotificationEvent } from './Notifier.js';

const log = getLogger('TradeEvents');

/**
 * Logs every engine event as structured JSON via winston.
 *
 * Each log entry carries an `event` field (the event type) as the primary
 * discriminator, plus the relevant fields for that event. Broker-action
 * events (ENTRY_TRIGGERED, BREAKEVEN_TRIGGERED, POSITION_CLOSED) also carry
 * an `action` field describing what should be done at the broker — phrased
 * in the present tense in Phase 1 (advisory), intended to evolve to past
 * tense in Phase 2 (auto-execution).
 *
 * PRICE_UPDATE is suppressed — tick volume makes it impractical to log.
 */
export class LoggerNotifier implements Notifier {
  async notify(event: NotificationEvent): Promise<void> {
    if (event.type === 'PRICE_UPDATE') return;

    switch (event.type) {
      case 'SIGNAL_LOADED':
        log.info('Signal loaded', {
          event: event.type,
          filePath: basename(event.filePath),
          date: event.signal.meta.date,
          dvs: event.signal.volatility.dvs,
          regime: event.signal.volatility.regime,
          vwap: event.signal.vwap.value,
        });
        break;

      case 'SIGNAL_INVALID':
        log.error('Signal invalid', {
          event: event.type,
          filePath: basename(event.filePath),
          errors: event.errors,
        });
        break;

      case 'SIGNAL_WARNING':
        log.warn('Signal warnings', {
          event: event.type,
          filePath: basename(event.filePath),
          warnings: event.warnings,
        });
        break;

      case 'DVS_GATE_BLOCKED':
        log.warn('DVS gate blocked — no trades today', {
          event: event.type,
          dvs: event.dvs,
          gate: event.gate,
        });
        break;

      case 'NO_TRADE_SETUP':
        log.info('No trade setup', {
          event: event.type,
          reason: event.reason,
        });
        break;

      case 'SETUP_READY':
        log.info('Trade setup ready', {
          event: event.type,
          direction: event.direction,
          entry1: event.entries[0]?.price,
          entry2: event.entries[1]?.price,
          entry3: event.entries[2]?.price,
          vwap: event.vwap,
          stopPoints: event.stopPoints,
        });
        break;

      case 'ENTRY_TRIGGERED': {
        const verb = event.entryNumber === 1 ? 'Open' : 'Scale into';
        const dir = event.direction.toUpperCase();
        log.info('Entry triggered', {
          event: event.type,
          direction: event.direction,
          entryNumber: event.entryNumber,
          price: event.price,
          avgEntry: event.avgEntry,
          currentStop: event.currentStop,
          allocationPct: event.allocationPct,
          fillsRemaining: event.fillsRemaining,
          action: `${verb} ${dir} at broker (${event.allocationPct}% size). Set stop @ ${event.currentStop.toFixed(2)}.`,
        });
        break;
      }

      case 'BREAKEVEN_TRIGGERED':
        log.info('Breakeven triggered', {
          event: event.type,
          newStop: event.newStop,
          action: `Move stop at broker to ${event.newStop.toFixed(2)}. Cancel any unfilled entry orders.`,
        });
        break;

      case 'POSITION_CLOSED': {
        const dir = event.direction.toUpperCase();
        log.info('Position closed', {
          event: event.type,
          direction: event.direction,
          avgEntry: event.avgEntry,
          closePrice: event.closePrice,
          pnlPoints: event.pnlPoints,
          reason: event.reason,
          action: `Close ${dir} position at broker now (reason: ${event.reason}).`,
        });
        break;
      }

      case 'DAILY_LOCK':
        log.info('Daily lock applied', {
          event: event.type,
          reason: event.reason,
        });
        break;

      case 'ENGINE_ERROR':
        log.error('Engine error', {
          event: event.type,
          message: event.message,
        });
        break;
    }
  }
}
