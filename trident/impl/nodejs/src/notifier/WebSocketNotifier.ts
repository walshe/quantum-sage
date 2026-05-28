import type { WebSocket, WebSocketServer } from 'ws';
import type { Notifier, NotificationEvent } from './Notifier.js';
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
   * (stale signal discarded, expiry before entry, invalidation before entry),
   * this holds a human-readable explanation. Null when idle from a clean start
   * or after a new signal was subsequently loaded.
   * Lets clients that connect after the live event still see *why* it's idle.
   */
  lastIdleReason: string | null;
  /**
   * Server process timezone — included so the dashboard can warn the analyst
   * that time fields (timestamp, expiry, vwap.updated_at) are interpreted in
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
    biasConfidence: string | null;
  } | null;
  position: {
    direction: 'long' | 'short';
    avgEntry: number;
    currentStop: number;
    vwapTarget: number;
    fills: number;
    breakEvenActive: boolean;
  } | null;
}

type Envelope =
  | { kind: 'bootstrap'; data: Bootstrap }
  | { kind: 'event'; data: Record<string, unknown> };

/**
 * Broadcasts engine notifications to connected browser clients and sends each
 * new client a bootstrap message on connect so late-joiners see current state.
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

  constructor(
    wss: WebSocketServer,
    private readonly getBootstrap: () => Bootstrap,
    opts: {
      includePriceUpdates?: boolean;
      priceThrottleMs?: number;
      /** Optional: return a NotificationEvent to replay immediately after the bootstrap (e.g. SETUP_READY when engine is already watching). */
      getReplayEvent?: () => NotificationEvent | null;
    } = {}
  ) {
    this.includePriceUpdates = opts.includePriceUpdates ?? false;
    this.priceThrottleMs = opts.priceThrottleMs ?? 250;
    this.getReplayEvent = opts.getReplayEvent ?? null;
    wss.on('connection', ws => this.handleConnection(ws));
  }

  private readonly getReplayEvent: (() => NotificationEvent | null) | null;

  private handleConnection(ws: WebSocket): void {
    this.clients.add(ws);
    log.debug('Client connected', { total: this.clients.size });
    try {
      ws.send(this.encode({ kind: 'bootstrap', data: this.getBootstrap() }));
    } catch (err) {
      log.warn('Failed to send bootstrap', { error: (err as Error).message });
    }
    // Replay the active setup event so the live log shows it even on reconnect
    if (this.getReplayEvent) {
      try {
        const event = this.getReplayEvent();
        if (event) {
          const formatted = formatEvent(event);
          ws.send(this.encode({ kind: 'event', data: { ...formatted, raw: event } }));
        }
      } catch (err) {
        log.warn('Failed to send replay event', { error: (err as Error).message });
      }
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
    if (event.type === 'PRICE_UPDATE') {
      if (!this.includePriceUpdates) return;
      const now = Date.now();
      if (now - this.lastPriceBroadcastMs < this.priceThrottleMs) return;
      this.lastPriceBroadcastMs = now;
    }
    const formatted = formatEvent(event);
    const payload = this.encode({
      kind: 'event',
      data: { ...formatted, raw: event },
    });
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
