import type { Notifier, NotificationEvent } from './Notifier.js';
import { formatEvent, type FormattedEvent } from './eventFormatter.js';

/**
 * Prints events to stdout. Designed to be readable at a glance.
 * Set showPriceTicks to false to suppress the high-frequency price updates.
 */
export class ConsoleNotifier implements Notifier {
  constructor(private showPriceTicks = false) {}

  async notify(event: NotificationEvent): Promise<void> {
    if (event.type === 'PRICE_UPDATE' && !this.showPriceTicks) return;

    const f = formatEvent(event);
    const sink =
      f.severity === 'error' ? console.error :
      f.severity === 'warn'  ? console.warn  :
      console.log;

    sink(render(f));
  }
}

// Column width of the `[tag]...` block so headlines line up across event
// types. Hand-tuned per event-type category to match the original formatting.
function tagColumnWidth(type: string): number {
  if (type === 'ENTRY_TRIGGERED' || type === 'BREAKEVEN_TRIGGERED') return 12;
  if (type === 'POSITION_CLOSED') return 14;
  return 11;
}

function renderTag(tag: string, type: string): string {
  const bracketed = `[${tag}]`;
  const pad = Math.max(1, tagColumnWidth(type) - bracketed.length);
  return bracketed + ' '.repeat(pad);
}

const DETAIL_INDENT = ' '.repeat(13);

function render(f: FormattedEvent): string {
  const lines: string[] = [];
  lines.push(`[${f.timestamp}] ${renderTag(f.tag, f.type)}${f.headline}`);
  for (const d of f.detail) lines.push(`${DETAIL_INDENT}${d}`);
  if (f.action) lines.push(`${DETAIL_INDENT}>>> ACTION: ${f.action}`);
  return lines.join('\n');
}
