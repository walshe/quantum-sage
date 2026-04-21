import type { Notifier, NotificationEvent } from './Notifier.js';

/**
 * Prints events to stdout. Designed to be readable at a glance.
 * Set showPriceTicks to false to suppress the high-frequency price updates.
 */
export class ConsoleNotifier implements Notifier {
  constructor(private showPriceTicks = false) {}

  async notify(event: NotificationEvent): Promise<void> {
    const ts = timestamp();

    switch (event.type) {
      case 'SIGNAL_LOADED':
        console.log(
          `${ts} [SIGNAL]   Loaded ${event.filePath}\n` +
            `             Date: ${event.signal.meta.date} | DVS: ${event.signal.volatility.dvs} (${event.signal.volatility.regime}) | VWAP: ${event.signal.vwap.value}`
        );
        break;

      case 'SIGNAL_INVALID':
        console.error(`${ts} [INVALID]  ${event.filePath}`);
        for (const e of event.errors) console.error(`             ✗ ${e}`);
        break;

      case 'SIGNAL_WARNING':
        console.warn(`${ts} [WARN]     ${event.filePath}`);
        for (const w of event.warnings) console.warn(`             ⚠ ${w}`);
        break;

      case 'DVS_GATE_BLOCKED':
        console.log(
          `${ts} [DVS GATE] NO TRADES TODAY — DVS ${event.dvs} exceeds gate ${event.gate}`
        );
        break;

      case 'NO_TRADE_SETUP':
        console.log(`${ts} [NO SETUP] ${event.reason}`);
        break;

      case 'SETUP_READY': {
        const dir = event.direction.toUpperCase();
        console.log(`${ts} [SETUP]    ${dir} trade ready`);
        for (const e of event.entries) {
          console.log(
            `             Entry ${e.entryNumber}: ${fmt(e.price)} (${e.allocationPct}%)`
          );
        }
        console.log(
          `             Stop: ${event.stopPoints}pts from avg entry | Target: VWAP @ ${fmt(event.vwap)}`
        );
        break;
      }

      case 'ENTRY_TRIGGERED': {
        const dir = event.direction.toUpperCase();
        const verb = event.entryNumber === 1 ? 'Open' : 'Scale into';
        console.log(
          `${ts} [ENTRY ${event.entryNumber}]   ${dir} @ ${fmt(event.price)} (${event.allocationPct}%)\n` +
            `             Avg entry: ${fmt(event.avgEntry)} | Stop: ${fmt(event.currentStop)} | Fills remaining: ${event.fillsRemaining}\n` +
            `             >>> ACTION: ${verb} ${dir} at broker (${event.allocationPct}% size). Set stop @ ${fmt(event.currentStop)}.`
        );
        break;
      }

      case 'BREAKEVEN_TRIGGERED':
        console.log(
          `${ts} [BREAKEVEN] Stop moved to ${fmt(event.newStop)} (avg entry)\n` +
            `             >>> ACTION: Move stop at broker to ${fmt(event.newStop)}. Cancel any unfilled entry orders.`
        );
        break;

      case 'POSITION_CLOSED': {
        const sign = event.pnlPoints >= 0 ? '+' : '';
        const label = event.pnlPoints >= 0 ? 'WIN ' : 'LOSS';
        const dir = event.direction.toUpperCase();
        console.log(
          `${ts} [CLOSED ${label}] ${dir} closed @ ${fmt(event.closePrice)} — ` +
            `${sign}${event.pnlPoints.toFixed(2)} pts (${event.reason})\n` +
            `             >>> ACTION: Close ${dir} position at broker now (reason: ${event.reason}).`
        );
        break;
      }

      case 'DAILY_LOCK':
        console.log(`${ts} [LOCK]     No more trades today — ${event.reason}`);
        break;

      case 'PRICE_UPDATE':
        if (this.showPriceTicks) {
          console.log(`${ts} [PRICE]    ${fmt(event.price)}`);
        }
        break;

      case 'ENGINE_ERROR':
        console.error(`${ts} [ERROR]    ${event.message}`);
        break;
    }
  }
}

function timestamp(): string {
  return `[${new Date().toTimeString().slice(0, 8)}]`;
}

function fmt(price: number): string {
  return price.toFixed(2);
}
