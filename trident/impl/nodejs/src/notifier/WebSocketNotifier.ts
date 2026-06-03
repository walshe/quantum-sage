import type { WebSocket, WebSocketServer } from 'ws';
import type { Notifier, NotificationEvent, AccountInfo } from './Notifier.js';
import { formatEvent } from './eventFormatter.js';
import { getLogger } from '../logger.js';

const log = getLogger('WebSocketNotifier');

/**
 * Payload sent to a browser client the moment it connects — tells it what the
 * engine is currently doing so a freshly-opened tab doesn't start blank.
 *
 * Kept intentionally narrow: only the fields the UI's status band and
 * pre-fill-from-latest logic actually need. Extend cautiously.
 */
export interface Bootstrap {
  serverTime: string;               // ISO8601
  state: 'idle' | 'watching' | 'in_trade' | 'blocked' | 'closed';
  dailyLocked: boolean;
  symbol: string;                   // instrument the feed is tracking, e.g. "US500"
  /**
   * When state is 'idle' and the engine went idle due to a non-trade event
   * (stale signal discarded, or cancelled before entry),
   * this holds a human-readable explanation. Null when idle from a clean start
   * or after a new signal was subsequently loaded.
   * Lets clients that connect after the live event still see *why* it's idle.
   */
  lastIdleReason: string | null;
  /**
   * Server process timezone — included so the dashboard can warn the analyst
   * that time fields (timestamp, vwap.updated_at) are interpreted in
   * this timezone, not necessarily their own browser timezone.
   */
  serverTz: {
    ianaName: string;   // IANA name, e.g. "Europe/Dublin"
    offsetStr: string;  // UTC offset string, e.g. "UTC+1"
  };
  currentSignal: {
    filePath: string;
    date: string;
    timestamp: string;
    updateSeq: number;
    dvs: number;
    vwap: number;
    biasDirection: string | null;
  } | null;
  position: {
    direction: 'long' | 'short';
    avgEntry: number;
    currentStop: number;
    vwapTarget: number;
    fills: number;
    fillDetails: Array<{ entryNumber: 1 | 2 | 3; price: number; allocationPct: number }>;
    breakEvenActive: boolean;
    entrySignalFilePath: string;
    entrySignal: unknown;
  } | null;
  /**
   * Stop-loss distance in points (from config). Sent in the bootstrap so the
   * trade plan note can show the worst-case stop immediately on connect, without
   * waiting for a SETUP_READY event to carry it.
   */
  stopPoints: number;
  /** Live demo account balance and unrealized PnL. Null when no trader is configured. */
  account: AccountInfo | null;
}

type Envelope =
  | { kind: 'bootstrap';      data: Bootstrap }
  | { kind: 'event';          data: Record<string, unknown> }
  | { kind: 'history';        data: Array<Record<string, unknown>> }
  | { kind: 'account_update'; data: AccountInfo };

/**
 * Broadcasts engine notifications to connected browser clients and sends each
 * new client a bootstrap message on connect so late-joiners see current state.
 *
 * Every non-price event is buffered server-side (last BUFFER_LIMIT entries).
 * On connect, the full buffer is sent as a `history` envelope before the
 * bootstrap so the client can rebuild the log even after a reconnect — no
 * blank log, no duplicate entries.
 *
 * The owning caller (the web server module) creates the underlying
 * WebSocketServer and passes it in; this class owns only client lifecycle and
 * the broadcast loop.
 */
export class WebSocketNotifier implements Notifier {
  private readonly clients = new Set<WebSocket>();
  private readonly includePriceUpdates: boolean;
  private readonly priceThrottleMs: number;
  private lastPriceBroadcastMs = 0;
  private readonly eventBuffer: Array<Record<string, unknown>> = [];
  private readonly BUFFER_LIMIT = 150;

  constructor(
    wss: WebSocketServer,
    private readonly getBootstrap: () => Bootstrap,
    opts: {
      includePriceUpdates?: boolean;
      priceThrottleMs?: number;
    } = {}
  ) {
    this.includePriceUpdates = opts.includePriceUpdates ?? false;
    this.priceThrottleMs = opts.priceThrottleMs ?? 250;
    wss.on('connection', ws => this.handleConnection(ws));
  }

  private handleConnection(ws: WebSocket): void {
    this.clients.add(ws);
    log.debug('Client connected', { total: this.clients.size });
    // Send the event history first so the client can rebuild the log before
    // the bootstrap snapshot resets state. The client clears its log on
    // receipt of this message, eliminating both the blank-log-on-reconnect
    // and the old duplicate-entries problems.
    try {
      ws.send(this.encode({ kind: 'history', data: [...this.eventBuffer] }));
    } catch (err) {
      log.warn('Failed to send history', { error: (err as Error).message });
    }
    try {
      ws.send(this.encode({ kind: 'bootstrap', data: this.getBootstrap() }));
    } catch (err) {
      log.warn('Failed to send bootstrap', { error: (err as Error).message });
    }
    ws.on('close', () => {
      this.clients.delete(ws);
      log.debug('Client disconnected', { total: this.clients.size });
    });
    ws.on('error', err => {
      log.warn('Client socket error', { error: err.message });
      this.clients.delete(ws);
    });
  }

  async notify(event: NotificationEvent): Promise<void> {
    if (event.type === 'ACCOUNT_UPDATE') {
      const { type: _, ...info } = event;
      const payload = this.encode({ kind: 'account_update', data: info as AccountInfo });
      for (const client of this.clients) {
        if (client.readyState === 1) {
          try { client.send(payload); } catch { /* close handler will remove it */ }
        }
      }
      return;
    }
    if (event.type === 'PRICE_UPDATE') {
      if (!this.includePriceUpdates) return;
      const now = Date.now();
      if (now - this.lastPriceBroadcastMs < this.priceThrottleMs) return;
      this.lastPriceBroadcastMs = now;
    }
    const formatted = formatEvent(event);
    const entry = { ...formatted, raw: event };
    // Buffer all non-price events so new/reconnecting clients can replay them.
    if (event.type !== 'PRICE_UPDATE') {
      this.eventBuffer.push(entry);
      if (this.eventBuffer.length > this.BUFFER_LIMIT) {
        this.eventBuffer.shift();
      }
    }
    const payload = this.encode({ kind: 'event', data: entry });
    for (const client of this.clients) {
      // ws readyState 1 === OPEN; checking numerically avoids importing the const.
      if (client.readyState === 1) {
        try {
          client.send(payload);
        } catch (err) {
          log.warn('Failed to broadcast to client', {
            error: (err as Error).message,
          });
          // Let the close/error handler remove it; don't mutate set mid-iteration.
        }
      }
    }
  }

  clientCount(): number {
    return this.clients.size;
  }

  private encode(envelope: Envelope): string {
    return JSON.stringify(envelope);
  }
}
