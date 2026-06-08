/**
 * src/price-feed/CTraderPriceFeed.ts
 *
 * Real-time price feed backed by the cTrader Open API (JSON over WebSocket).
 *
 * Delegates WebSocket management, authentication, heartbeat, and token refresh
 * to CTraderSession. This class owns only the price-feed concerns: symbol
 * resolution, spot subscription, and OHLCV bar fetching.
 *
 * ── JSON vs Protobuf ────────────────────────────────────────────────────────
 * Port 5036 — JSON (text)  ← we use this one
 * Port 5035 — Protobuf (binary)
 * Both carry the same messages. "Proto" in message names is cTrader's naming
 * convention, not an indication that protobuf is required.
 *
 * ── Connection flow ──────────────────────────────────────────────────────────
 *   1. connect() → CTraderSession drives app auth + account auth
 *   2.           → ACCOUNT_AUTH_RES handler fires: resolve symbol (list or config)
 *   3.           → SUBSCRIBE_SPOTS_REQ: start the bid/ask stream
 *   4. SPOT_EVENT arrives on every tick → fires subscriber callback with mid price
 *
 * ── Price encoding ──────────────────────────────────────────────────────────
 * cTrader sends prices as integers (actual price × 100,000).
 * Bid and ask can arrive in separate SPOT_EVENTs. We track both sides and
 * only emit a price once we have seen at least one of each.
 *
 * ── Keep-alive ──────────────────────────────────────────────────────────────
 * Managed by CTraderSession. Set CTRADER_NO_HEARTBEAT=true for demo servers
 * that reject payloadType 0.
 */

import { getLogger } from '../logger.js';
import type { PriceFeed } from './PriceFeed.js';
import { CTraderSession, PT } from './CTraderSession.js';
import type { CTraderMessage } from './CTraderSession.js';

const log = getLogger('CTraderPriceFeed');

// cTrader encodes all prices as integers: actual_price × 100,000.
const PRICE_DIVISOR = 100_000;

const BAR_REQUEST_TIMEOUT_MS = 10_000;
const PERIOD_M1 = 1;

// ── Internal types ───────────────────────────────────────────────────────────

interface CTraderSymbol {
  symbolId:   number;
  symbolName: string;
}

interface RawTrendbar {
  volume?:                number;
  low?:                   number;
  deltaOpen?:             number;
  deltaClose?:            number;
  deltaHigh?:             number;
  utcTimestampInMinutes?: number;
}

interface PendingBarRequest {
  resolve: (bars: OhlcvBar[]) => void;
  reject:  (err: Error) => void;
  timer:   ReturnType<typeof setTimeout>;
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface OhlcvBar {
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  volume:    number;
  timestamp: number; // Unix milliseconds (start of bar)
}

export interface CTraderPriceFeedConfig {
  clientId:     string;
  clientSecret: string;
  accessToken:  string;
  /** Symbol name to subscribe to, e.g. "US500" or "USTEC". Case-insensitive.
   *  If the exact name isn't found, a prefix match is tried. */
  symbolName:   string;
  /** Numeric account ID. If omitted, the session picks the first live account. */
  accountId?:   number;
  /** Numeric symbol ID. If supplied, the SYMBOL_LIST_REQ step is skipped.
   *  Useful for demo environments that don't support SYMBOL_LIST_REQ. */
  symbolId?:    number;
  /** WebSocket endpoint. Defaults to the live server.
   *  Set CTRADER_WS_URL=wss://demo.ctraderapi.com:5036 for demo use. */
  wsUrl?:         string;
  /** Disable client-initiated heartbeats. Set CTRADER_NO_HEARTBEAT=true for
   *  demo servers that close the connection on payloadType 0. */
  noHeartbeat?:   boolean;
  /** Refresh token. When present, the session refreshes the access token
   *  automatically if it is within 5 minutes of expiry. */
  refreshToken?:  string;
  /** Unix timestamp (seconds) when the access token expires. */
  tokenExpiresAt?: number;
  /** Called after a successful token refresh with the new token values. */
  onTokenRefresh?: (tokens: { accessToken: string; refreshToken: string; expiresAt: number }) => void;
}

// ── Implementation ───────────────────────────────────────────────────────────

export class CTraderPriceFeed implements PriceFeed {
  private readonly cfg: CTraderPriceFeedConfig;
  private readonly session: CTraderSession;

  private symbolId:     number | null = null;
  private callback:     ((price: number) => void) | null = null;
  private latestPrice:  number | null = null;
  private lastRawBid:   number | null = null;
  private lastRawAsk:   number | null = null;

  private pendingBarRequests = new Map<string, PendingBarRequest>();

  constructor(cfg: CTraderPriceFeedConfig) {
    this.cfg = cfg;
    this.session = new CTraderSession({
      clientId:       cfg.clientId,
      clientSecret:   cfg.clientSecret,
      accessToken:    cfg.accessToken,
      accountId:      cfg.accountId,
      wsUrl:          cfg.wsUrl,
      noHeartbeat:    cfg.noHeartbeat,
      refreshToken:   cfg.refreshToken,
      tokenExpiresAt: cfg.tokenExpiresAt,
      onTokenRefresh: cfg.onTokenRefresh,
    });
  }

  // ── PriceFeed interface ──────────────────────────────────────────────────

  subscribe(callback: (price: number) => void): void {
    this.callback = callback;
  }

  getLatestPrice(): number | null {
    return this.latestPrice;
  }

  getResolvedSymbolId(): number | null {
    return this.symbolId;
  }

  /**
   * Fetches today's M1 bars (midnight UTC → now) via the authenticated session.
   * Throws if the feed is not connected or no response arrives within 10 seconds.
   */
  async getTodayBars(): Promise<OhlcvBar[]> {
    if (this.session.accountId === null || this.symbolId === null) {
      throw new Error('feed not connected');
    }

    const nowMs      = Date.now();
    const midnightMs = new Date(nowMs).setUTCHours(0, 0, 0, 0);

    return new Promise<OhlcvBar[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingBarRequests.delete(msgId);
        reject(new Error('bar request timed out'));
      }, BAR_REQUEST_TIMEOUT_MS);

      // send() returns the clientMsgId so we can key the pending request
      const msgId = this.session.send({
        payloadType: PT.GET_TRENDBAR_REQ,
        payload: {
          ctidTraderAccountId: this.session.accountId,
          symbolId:            this.symbolId,
          period:              PERIOD_M1,
          fromTimestamp:       midnightMs,
          toTimestamp:         nowMs,
        },
      });

      this.pendingBarRequests.set(msgId, { resolve, reject, timer });
      log.debug('Sent GET_TRENDBAR_REQ', { msgId, fromTimestamp: midnightMs, toTimestamp: nowMs });
    });
  }

  /**
   * Connects to cTrader: delegates auth to CTraderSession, then drives symbol
   * resolution and spot subscription. Resolves once spot events are flowing.
   */
  async connect(): Promise<void> {
    log.info('Connecting price feed', { symbol: this.cfg.symbolName });

    // Register all handlers before the session opens the socket — some may
    // fire during the handshake (ACCOUNT_AUTH_RES triggers the symbol step).
    this.registerHandlers();

    // Session drives app auth → account list → account auth, then resolves.
    await this.session.connect();

    // The ACCOUNT_AUTH_RES handler already started the symbol flow (async).
    // Now wait for SUBSCRIBE_SPOTS_RES or the first SPOT_EVENT to confirm ticks.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        // Replace the spot handler with the permanent one (without the settle call)
        this.session.onMessage(PT.SPOT_EVENT, msg => this.handleSpotEvent(msg.payload ?? {}));
        if (err) reject(err); else resolve();
      };

      this.session.onMessage(PT.SUBSCRIBE_SPOTS_RES, () => {
        log.info('Spot subscription active', { symbol: this.cfg.symbolName });
        settle();
      });

      // Some servers (e.g. demo) skip SUBSCRIBE_SPOTS_RES and just start sending ticks.
      this.session.onMessage(PT.SPOT_EVENT, msg => {
        settle();
        this.handleSpotEvent(msg.payload ?? {});
      });
    });
  }

  async disconnect(): Promise<void> {
    // Unsubscribe before closing — avoids the server buffering ticks we'll never read
    if (this.session.accountId !== null && this.symbolId !== null) {
      this.session.send({
        payloadType: PT.UNSUBSCRIBE_SPOTS_REQ,
        payload: {
          ctidTraderAccountId: this.session.accountId,
          symbolId:            [this.symbolId],
        },
      });
    }

    for (const [, pending] of this.pendingBarRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('feed disconnected'));
    }
    this.pendingBarRequests.clear();

    await this.session.disconnect();
  }

  // ── Handler registration ──────────────────────────────────────────────────

  private registerHandlers(): void {
    this.session.onMessage(PT.ACCOUNT_AUTH_RES, () => {
      // SYMBOL_LIST_REQ is rejected by the demo endpoint regardless of timing.
      // A short delay lets the server finish its internal session setup first.
      setTimeout(() => {
        if (this.cfg.symbolId !== undefined) {
          this.symbolId = this.cfg.symbolId;
          log.info('Using configured symbolId — subscribing to spots', { symbolId: this.symbolId });
          this.sendSubscribeSpotsReq();
        } else {
          log.debug('Requesting symbol list');
          this.session.send({
            payloadType: PT.SYMBOL_LIST_REQ,
            payload: { ctidTraderAccountId: this.session.accountId },
          });
        }
      }, 2000);
    });

    this.session.onMessage(PT.SYMBOL_LIST_RES, msg => {
      if (this.cfg.symbolId !== undefined) {
        this.symbolId = this.cfg.symbolId;
        log.info('Symbol list received — using configured symbolId', { symbolId: this.symbolId });
      } else {
        const symbols = (msg.payload?.symbol ?? []) as CTraderSymbol[];
        const target  = this.cfg.symbolName.toUpperCase();
        const found   = symbols.find(
          s => s.symbolName.toUpperCase() === target ||
               s.symbolName.toUpperCase().startsWith(target)
        );
        if (!found) {
          const names = symbols.slice(0, 20).map(s => s.symbolName).join(', ');
          log.error('Symbol not found', { symbolName: this.cfg.symbolName, available: names });
          return;
        }
        this.symbolId = found.symbolId;
        log.info('Symbol resolved', { symbolName: found.symbolName, symbolId: this.symbolId });
      }
      this.sendSubscribeSpotsReq();
    });

    this.session.onMessage(PT.GET_TRENDBAR_RES, msg => {
      const pending = msg.clientMsgId
        ? this.pendingBarRequests.get(msg.clientMsgId)
        : undefined;
      if (!pending) {
        log.debug('Received GET_TRENDBAR_RES with no pending request', { clientMsgId: msg.clientMsgId });
        return;
      }
      clearTimeout(pending.timer);
      this.pendingBarRequests.delete(msg.clientMsgId!);

      const rawBars = (msg.payload?.trendbar ?? []) as RawTrendbar[];
      const bars: OhlcvBar[] = rawBars.map(b => {
        const low       = (b.low        ?? 0) / PRICE_DIVISOR;
        const open      = low + (b.deltaOpen  ?? 0) / PRICE_DIVISOR;
        const close     = low + (b.deltaClose ?? 0) / PRICE_DIVISOR;
        const high      = low + (b.deltaHigh  ?? 0) / PRICE_DIVISOR;
        const volume    = b.volume ?? 0;
        const timestamp = (b.utcTimestampInMinutes ?? 0) * 60_000;
        return { open, high, low, close, volume, timestamp };
      });

      log.debug('GET_TRENDBAR_RES received', { barsCount: bars.length, clientMsgId: msg.clientMsgId });
      pending.resolve(bars);
    });

    this.session.onMessage(PT.ERROR_RES, msg => {
      const errorCode   = msg.payload?.errorCode   ?? 'UNKNOWN';
      const description = String(msg.payload?.description ?? '');

      // Reply to a pending getTodayBars() request
      if (msg.clientMsgId) {
        const barPending = this.pendingBarRequests.get(msg.clientMsgId);
        if (barPending) {
          clearTimeout(barPending.timer);
          this.pendingBarRequests.delete(msg.clientMsgId);
          barPending.reject(new Error(`cTrader error ${errorCode}: ${description}`));
          return;
        }
      }

      log.error('cTrader API error (post-auth)', { errorCode, description });
    });
  }

  // ── Spot event processing ────────────────────────────────────────────────

  private handleSpotEvent(payload: Record<string, unknown>): void {
    const rawBid = payload['bid'] as number | undefined;
    const rawAsk = payload['ask'] as number | undefined;

    if (rawBid !== undefined) this.lastRawBid = rawBid;
    if (rawAsk !== undefined) this.lastRawAsk = rawAsk;

    if (this.lastRawBid === null || this.lastRawAsk === null) return;

    const bid   = this.lastRawBid / PRICE_DIVISOR;
    const ask   = this.lastRawAsk / PRICE_DIVISOR;
    const mid   = (bid + ask) / 2;
    const price = Math.round(mid * 100) / 100;

    this.latestPrice = price;
    this.callback?.(price);

    log.debug('Spot event', { bid, ask, mid: price });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private sendSubscribeSpotsReq(): void {
    this.session.send({
      payloadType: PT.SUBSCRIBE_SPOTS_REQ,
      payload: {
        ctidTraderAccountId:      this.session.accountId,
        symbolId:                 [this.symbolId],
        subscribeToSpotTimestamp: false,
      },
    });
  }
}
