/**
 * src/price-feed/CTraderPriceFeed.ts
 *
 * Real-time price feed backed by the cTrader Open API (JSON over WebSocket).
 *
 * ── JSON vs Protobuf ────────────────────────────────────────────────────────
 * The cTrader Open API exposes two ports on the same host:
 *
 *   Port 5035 — Protobuf (binary)
 *     Messages are serialised with Google Protocol Buffers. Very compact on the
 *     wire, but requires you to compile .proto schema files and use a protobuf
 *     library to encode/decode every message. More work to set up.
 *
 *   Port 5036 — JSON (text)  ← we use this one
 *     Every message is a plain JSON object with three fields:
 *       { clientMsgId, payloadType, payload }
 *     No schema files or binary encoding needed — just JSON.parse / JSON.stringify.
 *     The downside is slightly larger messages, which is irrelevant for a low-
 *     frequency trading engine that only cares about one symbol.
 *
 * Both ports carry exactly the same messages and semantics. "Proto" in the
 * message names (e.g. ProtoOASpotEvent) is just cTrader's naming convention —
 * it doesn't mean you're using protobuf. The JSON port works fine.
 *
 * ── Message structure ───────────────────────────────────────────────────────
 * Every message you send or receive looks like this:
 *
 *   {
 *     "clientMsgId": "3",          // your own ID so you can correlate replies
 *     "payloadType": 2100,         // integer that identifies the message type
 *     "payload": { ... }           // the actual data for that message type
 *   }
 *
 * The API is event-driven, not request/response. You send a request and later
 * receive a response event on the same WebSocket — there's no await for a reply.
 * That's why the handshake is a chain of cases in handleMessage() rather than a
 * sequence of awaited calls.
 *
 * ── Connection flow ─────────────────────────────────────────────────────────
 *   1. connect()  → open WebSocket to live1.p.ctrader.com:5036
 *   2.            → APP_AUTH_REQ       prove this is a registered app
 *   3.            → GET_ACCOUNTS_REQ   find which account ID to trade on
 *   4.            → ACCOUNT_AUTH_REQ   authorise that account for this session
 *   5.            → SYMBOL_LIST_REQ    look up the integer symbolId for our instrument
 *   6.            → SUBSCRIBE_SPOTS_REQ  start the bid/ask stream
 *   7. SPOT_EVENT arrives on every tick → fires subscriber callback with mid price
 *
 * Once connect() resolves, the engine receives prices exactly as it does from
 * MockPriceFeed — it has no idea this class exists.
 *
 * ── Price encoding ──────────────────────────────────────────────────────────
 * cTrader sends prices as integers (actual price × 100,000), so 6598.67 arrives
 * as 659867000. We divide by 100,000 before passing the price on.
 *
 * Bid and ask can also arrive in *separate* SPOT_EVENT messages (partial updates).
 * We track the last seen value of each side and only emit a price once we have both.
 *
 * ── Keep-alive ──────────────────────────────────────────────────────────────
 * The API requires a heartbeat (payloadType 0) at least every 10 seconds or it
 * closes the connection. We send one on a fixed interval from the moment the
 * socket opens.
 */

import WebSocket from 'ws';
import { getLogger } from '../logger.js';
import type { PriceFeed } from './PriceFeed.js';

const log = getLogger('CTraderPriceFeed');

// ── cTrader API endpoints ───────────────────────────────────────────────────

// JSON protocol lives on port 5036. Protobuf would be port 5035.
const DEFAULT_WS_URL = 'wss://live.ctraderapi.com:5036';
const TOKEN_URL      = 'https://openapi.ctrader.com/apps/token';

// Refresh the access token this many seconds before it actually expires.
// Gives a comfortable window to handle slow networks or retry on failure.
const REFRESH_BUFFER_SECS = 300; // 5 minutes

// ── Payload type IDs ────────────────────────────────────────────────────────
// These integers identify each message type. Both the JSON and protobuf
// protocols use the same IDs — they're defined in cTrader's .proto schema files
// but we just use the numbers directly since we're on the JSON port.

const PT = {
  HEARTBEAT:            51,    // ping — sent every 10s to keep connection alive (payloadType 51 in current protocol)
  APP_AUTH_REQ:       2100,    // step 1: prove this app is registered with cTrader
  APP_AUTH_RES:       2101,
  ACCOUNT_AUTH_REQ:   2102,    // step 3: authorise a specific trading account
  ACCOUNT_AUTH_RES:   2103,
  NEW_ORDER_REQ:      2104,    // not used here — for order execution (future)
  SYMBOL_LIST_REQ:    2114,    // step 4: get the list of tradeable instruments
  SYMBOL_LIST_RES:    2115,
  SUBSCRIBE_SPOTS_REQ: 2127,   // step 5: start receiving bid/ask ticks
  SUBSCRIBE_SPOTS_RES: 2128,
  UNSUBSCRIBE_SPOTS_REQ: 2129, // sent on disconnect to clean up server-side
  SPOT_EVENT:         2131,    // incoming tick: { bid?, ask?, timestamp? }
  GET_ACCOUNTS_REQ:   2149,    // step 2: list accounts linked to this access token
  GET_ACCOUNTS_RES:   2150,
  ERROR_RES:          2142,    // any API-level error
} as const;

// cTrader encodes all prices as integers: actual_price × 100,000.
// e.g. 6598.67 is sent as 659867000. Divide by this to get the real number.
const PRICE_DIVISOR = 100_000;

// How often to send a heartbeat. The API drops connections that go silent
// for more than ~20s, so 10s gives a comfortable margin.
const HEARTBEAT_INTERVAL_MS = 10_000;

// ── Internal types ──────────────────────────────────────────────────────────

// Shape of every JSON message over the wire (in both directions)
interface CTraderMessage {
  clientMsgId?: string;                  // our own ID, echoed back in responses
  payloadType:  number;                  // identifies the message type
  payload?:     Record<string, unknown>; // the actual data
}

// Subset of fields we care about from the account list response
interface CTraderAccount {
  ctidTraderAccountId: number; // the numeric ID used in all subsequent requests
  isLive:              boolean;
  traderLogin:         number; // the human-readable account number shown in the UI
}

// Subset of fields from the symbol list response
interface CTraderSymbol {
  symbolId:   number; // integer ID used in spot subscriptions and order requests
  symbolName: string; // e.g. "US500", "USTEC", "EURUSD"
}

// ── Public config ───────────────────────────────────────────────────────────

export interface CTraderPriceFeedConfig {
  clientId:     string; // from CTRADER_CLIENT_ID in .env
  clientSecret: string; // from CTRADER_CLIENT_SECRET in .env
  accessToken:  string; // from CTRADER_ACCESS_TOKEN in .env (set by auth:ctrader)
  /** Symbol name to subscribe to, e.g. "US500" or "USTEC". Case-insensitive.
   *  If the exact name isn't found, a prefix match is tried. If still no match,
   *  connect() rejects and logs the first 20 available symbols to help you find
   *  the right name. */
  symbolName:   string;
  /** Numeric account ID. If omitted, the feed picks the first live account
   *  returned by the API. Set CTRADER_ACCOUNT_ID in .env to pin a specific one. */
  accountId?:   number;
  /** Numeric symbol ID. If supplied, the SYMBOL_LIST_REQ step is skipped entirely
   *  and this ID is used directly for the spot subscription. Useful when the server
   *  doesn't support SYMBOL_LIST_REQ (e.g. some demo environments) or to speed up
   *  startup. Find the ID in the cTrader portal under your account's symbol list,
   *  or set CTRADER_SYMBOL_ID in .env. */
  symbolId?:    number;
  /** WebSocket endpoint. Defaults to the live server.
   *  Set CTRADER_WS_URL=wss://demo.ctraderapi.com:5036 for demo/sandbox testing. */
  wsUrl?:         string;
  /** Disable client-initiated heartbeats. Some demo servers reject payloadType 0
   *  and close the connection. Set CTRADER_NO_HEARTBEAT=true in .env for demo use. */
  noHeartbeat?:   boolean;
  /** Refresh token from CTRADER_REFRESH_TOKEN in .env. When present, the feed will
   *  automatically refresh the access token before connecting if it is within 5
   *  minutes of expiry. cTrader refresh tokens never expire. */
  refreshToken?:  string;
  /** Unix timestamp (seconds) when the access token expires. From CTRADER_TOKEN_EXPIRES_AT.
   *  Used to decide whether a proactive refresh is needed before connecting. */
  tokenExpiresAt?: number;
  /** Called after a successful token refresh with the new token values. Use this to
   *  persist the updated tokens back to .env so the next restart picks them up. */
  onTokenRefresh?: (tokens: { accessToken: string; refreshToken: string; expiresAt: number }) => void;
}

// ── Implementation ──────────────────────────────────────────────────────────

export class CTraderPriceFeed implements PriceFeed {
  private readonly cfg: CTraderPriceFeedConfig;

  // Access token is mutable — updated in-place after a refresh so all
  // subsequent handshake messages automatically use the new value.
  private accessToken: string;

  private ws:             WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private callback:    ((price: number) => void) | null = null;
  private latestPrice: number | null = null;

  // These are null until the handshake resolves them
  private accountId: number | null = null;
  private symbolId:  number | null = null;

  // Simple incrementing counter — gives each outbound message a unique clientMsgId.
  // We don't actually use the IDs to correlate responses (the handshake is strictly
  // sequential), but the API requires the field to be present.
  private msgCounter = 0;

  // Last seen raw (integer-encoded) bid and ask. Tracked separately because
  // cTrader sometimes sends bid-only or ask-only SPOT_EVENTs as partial updates.
  // We hold off emitting a price until we've seen at least one of each.
  private lastRawBid: number | null = null;
  private lastRawAsk: number | null = null;

  constructor(cfg: CTraderPriceFeedConfig) {
    this.cfg         = cfg;
    this.accessToken = cfg.accessToken;
  }

  // ── PriceFeed interface ──────────────────────────────────────────────────

  subscribe(callback: (price: number) => void): void {
    this.callback = callback;
  }

  getLatestPrice(): number | null {
    return this.latestPrice;
  }

  /**
   * Opens the WebSocket, drives the full five-step auth + subscription
   * handshake, and resolves once spot events are flowing.
   *
   * The handshake is event-driven: each step sends a request and waits for
   * the corresponding response event in handleMessage() before sending the
   * next. connect() resolves (or rejects) via the `settle` callback once
   * either SUBSCRIBE_SPOTS_RES arrives or an error occurs at any step.
   */
  async connect(): Promise<void> {
    // Proactively refresh the access token if it is near (or past) expiry.
    // This covers the common case of restarting the server after 30+ days.
    // Note: an active WebSocket session survives token expiry on its own — we
    // only need a valid token at handshake time (GET_ACCOUNTS_REQ / ACCOUNT_AUTH_REQ).
    if (this.cfg.refreshToken && this.cfg.tokenExpiresAt !== undefined) {
      const secsUntilExpiry = this.cfg.tokenExpiresAt - Math.floor(Date.now() / 1000);
      if (secsUntilExpiry < REFRESH_BUFFER_SECS) {
        log.info('Access token near or past expiry — refreshing before connect', { secsUntilExpiry });
        await this.refreshAccessToken();
      }
    }

    return new Promise((resolve, reject) => {
      const wsUrl = this.cfg.wsUrl ?? DEFAULT_WS_URL;
      log.info('Connecting to cTrader Open API', { url: wsUrl, symbol: this.cfg.symbolName });

      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      // Guard against settle() being called more than once. This can happen if,
      // for example, an ERROR_RES arrives and then the socket also closes.
      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) {
          reject(err);
        } else {
          // Start heartbeat only after the connection is confirmed ready.
          // Skipped if cfg.noHeartbeat is set (e.g. demo servers that close on payloadType 0).
          if (!this.cfg.noHeartbeat) this.startHeartbeat();
          resolve();
        }
      };

      ws.on('open', () => {
        log.debug('WebSocket open — sending app auth');
        // Step 1: prove this application is registered in the cTrader portal
        this.send({
          payloadType: PT.APP_AUTH_REQ,
          payload: {
            clientId:     this.cfg.clientId,
            clientSecret: this.cfg.clientSecret,
          },
        });
      });

      ws.on('message', (raw: WebSocket.RawData) => {
        let msg: CTraderMessage;
        try {
          msg = JSON.parse(raw.toString()) as CTraderMessage;
        } catch {
          // Shouldn't happen on the JSON port, but guard anyway
          log.warn('Received non-JSON message from cTrader — ignoring');
          return;
        }
        this.handleMessage(msg, settle);
      });

      ws.on('error', (err: Error) => {
        log.error('WebSocket error', { message: err.message });
        settle(err);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        log.info('WebSocket closed', { code, reason: reason.toString() });
        this.stopHeartbeat();
        // If the socket closes before the handshake finished, treat it as an error
        settle(new Error(`WebSocket closed before ready (code ${code})`));
      });
    });
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();

    // Tell the server to stop sending spot events before closing — avoids the
    // server buffering ticks that we'll never read
    if (this.ws && this.accountId !== null && this.symbolId !== null) {
      this.send({
        payloadType: PT.UNSUBSCRIBE_SPOTS_REQ,
        payload: {
          ctidTraderAccountId: this.accountId,
          symbolId:            [this.symbolId], // API expects an array
        },
      });
    }

    // Wait for the close event rather than fire-and-forget
    await new Promise<void>(resolve => {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this.ws.once('close', () => resolve());
      this.ws.close();
    });

    this.ws = null;
  }

  // ── Handshake + message routing ──────────────────────────────────────────

  /**
   * Routes every inbound message to the right step of the handshake or to
   * the spot event handler. The `settle` callback is threaded through so any
   * step can resolve or reject the connect() promise.
   */
  private handleMessage(
    msg: CTraderMessage,
    settle: (err?: Error) => void
  ): void {
    log.debug('Received message', { payloadType: msg.payloadType, clientMsgId: msg.clientMsgId });

    switch (msg.payloadType) {

      // ── Step 1 response: app is authenticated ──────────────────────────
      case PT.APP_AUTH_RES: {
        log.debug('App auth OK — requesting account list');
        // Step 2: exchange the user's OAuth access token for their account list
        this.send({
          payloadType: PT.GET_ACCOUNTS_REQ,
          payload: { accessToken: this.accessToken },
        });
        break;
      }

      // ── Step 2 response: we have the account list ──────────────────────
      case PT.GET_ACCOUNTS_RES: {
        const accounts = (msg.payload?.ctidTraderAccount ?? []) as CTraderAccount[];
        log.debug('Account list received', { count: accounts.length });

        // Use the configured account ID if given; otherwise take the first live
        // account (FB's real money account). Falls back to accounts[0] if there's
        // no live account (e.g. sandbox / demo only).
        const account = this.cfg.accountId
          ? accounts.find(a => a.ctidTraderAccountId === this.cfg.accountId)
          : accounts.find(a => a.isLive) ?? accounts[0];

        if (!account) {
          settle(new Error('No matching cTrader account found for the provided access token'));
          return;
        }

        this.accountId = account.ctidTraderAccountId;
        log.info('Using account', { accountId: this.accountId, login: account.traderLogin, isLive: account.isLive });

        // Step 3: authorise this specific account for the session
        this.send({
          payloadType: PT.ACCOUNT_AUTH_REQ,
          payload: {
            ctidTraderAccountId: this.accountId,
            accessToken:         this.accessToken,
          },
        });
        break;
      }

      // ── Step 3 response: account is authorised ─────────────────────────
      case PT.ACCOUNT_AUTH_RES: {
        // SYMBOL_LIST_REQ (2115) is rejected by the demo endpoint regardless of
        // timing. If a symbolId is configured, skip straight to subscription after
        // a short settle delay. Otherwise fall back to the symbol list request
        // (works on some broker configurations).
        setTimeout(() => {
          if (this.cfg.symbolId !== undefined) {
            this.symbolId = this.cfg.symbolId;
            log.info('Using configured symbolId — subscribing to spots', { symbolId: this.symbolId });
            this.sendSubscribeSpotsReq();
          } else {
            log.debug('Requesting symbol list');
            this.send({
              payloadType: PT.SYMBOL_LIST_REQ,
              payload: { ctidTraderAccountId: this.accountId },
            });
          }
        }, 2000);
        break;
      }

      // ── Step 4 response: we have the symbol list ───────────────────────
      case PT.SYMBOL_LIST_RES: {
        // If a symbolId was supplied directly in config, use it — no name lookup needed.
        // We still had to wait for this response to ensure the broker is fully ready.
        if (this.cfg.symbolId !== undefined) {
          this.symbolId = this.cfg.symbolId;
          log.info('Symbol list received — using configured symbolId', { symbolId: this.symbolId });
        } else {
          const symbols = (msg.payload?.symbol ?? []) as CTraderSymbol[];
          const target = this.cfg.symbolName.toUpperCase();

          // Try exact match first, then prefix (e.g. "US500" matches "US500.cash")
          const found = symbols.find(
            s => s.symbolName.toUpperCase() === target ||
                 s.symbolName.toUpperCase().startsWith(target)
          );

          if (!found) {
            const names = symbols.slice(0, 20).map(s => s.symbolName).join(', ');
            settle(new Error(
              `Symbol "${this.cfg.symbolName}" not found in account's symbol list. ` +
              `First 20 available: ${names}`
            ));
            return;
          }

          this.symbolId = found.symbolId;
          log.info('Symbol resolved', { symbolName: found.symbolName, symbolId: this.symbolId });
        }

        // Step 5: broker is fully initialised — safe to subscribe to spots now
        this.sendSubscribeSpotsReq();
        break;
      }

      // ── Step 5 response: subscription confirmed ────────────────────────
      case PT.SUBSCRIBE_SPOTS_RES: {
        log.info('Spot subscription active', { symbol: this.cfg.symbolName });
        // Handshake is complete — connect() can now resolve
        settle();
        break;
      }

      // ── Live price tick ────────────────────────────────────────────────
      case PT.SPOT_EVENT: {
        // Some servers (e.g. demo) skip SUBSCRIBE_SPOTS_RES and just start
        // sending ticks. Treat the first tick as implicit confirmation.
        settle();
        this.handleSpotEvent(msg.payload ?? {});
        break;
      }

      // ── Server heartbeat ───────────────────────────────────────────────
      case PT.HEARTBEAT: {
        // Echo the heartbeat back immediately — the server closes the connection
        // if it doesn't receive a response within ~30 seconds.
        this.send({ payloadType: PT.HEARTBEAT });
        break;
      }

      // ── API error ──────────────────────────────────────────────────────
      case PT.ERROR_RES: {
        const errorCode   = msg.payload?.errorCode   ?? 'UNKNOWN';
        const description = String(msg.payload?.description ?? '');
        // The server internally triggers a SymbolsForConversion lookup when a spot
        // subscription is created (for P&L currency conversion). Demo environments
        // don't support this message but it does not affect the price stream — ignore it.
        if (description.includes('SymbolsForConversion')) {
          log.warn('Ignoring unsupported SymbolsForConversion request (demo limitation — does not affect price feed)');
          break;
        }
        // The demo server rejects payloadType 0 (heartbeat). Stop sending them and
        // carry on — the connection stays alive without client-initiated heartbeats.
        if (description.includes('payloadType: 0')) {
          log.warn('Server rejected heartbeat (payloadType 0) — disabling client heartbeats');
          this.stopHeartbeat();
          break;
        }
        log.error('cTrader API error', { errorCode, description });
        // Reject connect() if we haven't settled yet; otherwise just log
        settle(new Error(`cTrader error ${errorCode}: ${description}`));
        break;
      }

      default: {
        // The API sends a few informational messages we don't need (e.g. execution
        // events if orders are open on the account). Safe to ignore.
        log.debug('Unhandled payloadType', { payloadType: msg.payloadType });
      }
    }
  }

  // ── Spot event processing ────────────────────────────────────────────────

  private handleSpotEvent(payload: Record<string, unknown>): void {
    // Prices arrive as integers (actual × 100,000). Extract whichever sides
    // are present — a single event may carry bid only, ask only, or both.
    const rawBid = payload['bid'] as number | undefined;
    const rawAsk = payload['ask'] as number | undefined;

    if (rawBid !== undefined) this.lastRawBid = rawBid;
    if (rawAsk !== undefined) this.lastRawAsk = rawAsk;

    // Don't emit until we've seen at least one of each side
    if (this.lastRawBid === null || this.lastRawAsk === null) return;

    const bid = this.lastRawBid / PRICE_DIVISOR;
    const ask = this.lastRawAsk / PRICE_DIVISOR;

    // Use mid-price. The engine compares this against signal levels which are
    // also mid-market prices derived from options data, so mid is the right
    // reference. (We never trade the spread directly.)
    const mid = (bid + ask) / 2;
    const price = Math.round(mid * 100) / 100; // 2dp is fine; ES ticks in 0.25

    this.latestPrice = price;
    this.callback?.(price);

    log.debug('Spot event', { bid, ask, mid: price });
  }

  // ── Token refresh ────────────────────────────────────────────────────────

  /**
   * Exchanges the stored refresh token for a new access token and updates
   * this.accessToken in place. Fires cfg.onTokenRefresh so the caller can
   * persist the new values back to .env.
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.cfg.refreshToken) {
      throw new Error(
        'Access token is expired and no refresh token is configured. ' +
        'Re-run `npm run auth:ctrader` to get new tokens.'
      );
    }

    const url = new URL(TOKEN_URL);
    url.searchParams.set('grant_type',    'refresh_token');
    url.searchParams.set('refresh_token', this.cfg.refreshToken);
    url.searchParams.set('client_id',     this.cfg.clientId);
    url.searchParams.set('client_secret', this.cfg.clientSecret);

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) throw new Error(`Token refresh failed: HTTP ${res.status}`);

    const tokens = await res.json() as {
      accessToken:  string;
      refreshToken: string;
      expiresIn:    number;
      errorCode:    string | null;
      description:  string | null;
    };

    if (tokens.errorCode) {
      throw new Error(`Token refresh error: ${tokens.errorCode} — ${tokens.description}`);
    }

    const expiresAt = Math.floor(Date.now() / 1000) + tokens.expiresIn;

    this.accessToken = tokens.accessToken;
    log.info('Access token refreshed', { expiresInDays: Math.round(tokens.expiresIn / 86400) });

    this.cfg.onTokenRefresh?.({
      accessToken:  tokens.accessToken,
      // cTrader may or may not rotate the refresh token — keep the old one if absent
      refreshToken: tokens.refreshToken ?? this.cfg.refreshToken,
      expiresAt,
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private sendSubscribeSpotsReq(): void {
    this.send({
      payloadType: PT.SUBSCRIBE_SPOTS_REQ,
      payload: {
        ctidTraderAccountId:      this.accountId,
        symbolId:                 [this.symbolId],
        subscribeToSpotTimestamp: false,
      },
    });
  }

  private send(msg: Omit<CTraderMessage, 'clientMsgId'>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('Attempted to send while WebSocket not open', { payloadType: msg.payloadType });
      return;
    }
    // Attach a unique clientMsgId to every outbound message. The API requires
    // it to be present; it echoes it back in the response so you could use it
    // for correlation if needed.
    const full: CTraderMessage = {
      clientMsgId: String(++this.msgCounter),
      ...msg,
    };
    this.ws.send(JSON.stringify(full));
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ payloadType: PT.HEARTBEAT });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
