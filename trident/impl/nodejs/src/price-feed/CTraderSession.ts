/**
 * src/price-feed/CTraderSession.ts
 *
 * Authenticated cTrader Open API WebSocket session.
 *
 * Owns the WebSocket connection, drives the three-step auth handshake
 * (app auth → account list → account auth), manages heartbeat, and handles
 * token refresh. Exposes send() and an onMessage() handler registry so
 * consumers (CTraderPriceFeed, CTraderTrader) can register for the payload
 * types they care about without touching the session internals.
 *
 * Design: each consumer creates its own CTraderSession instance (Option C2).
 * Two connections, independent reconnect — if the price feed drops, position
 * management continues, and vice versa.
 *
 * Connection flow:
 *   1. connect() → open WebSocket
 *   2.            → APP_AUTH_REQ       prove this is a registered app
 *   3.            → GET_ACCOUNTS_REQ   find which account ID to use
 *   4.            → ACCOUNT_AUTH_REQ   authorise that account for this session
 *   5. connect() resolves — the session is fully authenticated
 *   Consumers then drive any further protocol steps (spot subscription, etc.)
 *   via their registered handlers and session.send().
 */

import WebSocket from 'ws';
import { getLogger } from '../logger.js';

const log = getLogger('CTraderSession');

// ── cTrader API endpoints ────────────────────────────────────────────────────

const DEFAULT_WS_URL = 'wss://live.ctraderapi.com:5036';
const TOKEN_URL      = 'https://openapi.ctrader.com/apps/token';

const REFRESH_BUFFER_SECS   = 300;
const HEARTBEAT_INTERVAL_MS = 10_000;

// ── Payload type IDs ─────────────────────────────────────────────────────────
// Exported so consumers (PriceFeed, Trader) can reference them without
// redefining them. Both JSON and protobuf protocols share these numeric IDs.

export const PT = {
  HEARTBEAT:              51,
  APP_AUTH_REQ:         2100,
  APP_AUTH_RES:         2101,
  ACCOUNT_AUTH_REQ:     2102,
  ACCOUNT_AUTH_RES:     2103,
  VERSION_REQ:          2104,
  VERSION_RES:          2105,
  NEW_ORDER_REQ:        2106,   // place order — used by CTraderOrderExecutor
  AMEND_POSITION_SLTP_REQ: 2110, // amend position stop-loss / take-profit (was wrongly 2112)
  CLOSE_POSITION_REQ:   2111,   // close position (was wrongly 2140)
  SYMBOL_LIST_REQ:      2114,
  SYMBOL_LIST_RES:      2115,
  TRADER_REQ:           2121,   // account details (balance, equity) — used by CTraderTrader (was wrongly 2120)
  TRADER_RES:           2122,   // (was wrongly 2121)
  RECONCILE_REQ:        2124,
  RECONCILE_RES:        2125,
  EXECUTION_EVENT:      2126,   // order fill / rejection events
  SUBSCRIBE_SPOTS_REQ:  2127,
  SUBSCRIBE_SPOTS_RES:  2128,
  UNSUBSCRIBE_SPOTS_REQ: 2129,
  SPOT_EVENT:           2131,
  ORDER_ERROR_EVENT:    2132,   // order error (e.g. TRADING_BAD_VOLUME)
  GET_TRENDBAR_REQ:     2137,
  GET_TRENDBAR_RES:     2138,
  ERROR_RES:            2142,
  GET_ACCOUNTS_REQ:     2149,
  GET_ACCOUNTS_RES:     2150,
} as const;

// ── Types ────────────────────────────────────────────────────────────────────

export interface CTraderMessage {
  clientMsgId?: string;
  payloadType:  number;
  payload?:     Record<string, unknown>;
}

interface CTraderAccount {
  ctidTraderAccountId: number;
  isLive:              boolean;
  traderLogin:         number;
  brokerTitleShort?:   string;
}

export interface CTraderSessionConfig {
  clientId:       string;
  clientSecret:   string;
  accessToken:    string;
  accountId?:     number;
  wsUrl?:         string;
  noHeartbeat?:   boolean;
  refreshToken?:  string;
  tokenExpiresAt?: number;
  onTokenRefresh?: (tokens: { accessToken: string; refreshToken: string; expiresAt: number }) => void;
}

type MessageHandler = (msg: CTraderMessage) => void;

// ── CTraderSession ───────────────────────────────────────────────────────────

export class CTraderSession {
  private readonly cfg: CTraderSessionConfig;
  private accessToken: string;

  private ws:             WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private msgCounter = 0;
  private _accountId:    number | null = null;
  private _traderLogin:  number | null = null;
  private _brokerName:   string | null = null;
  private _isLive:       boolean = false;

  // Consumer-registered handlers, keyed by payloadType
  private readonly handlers = new Map<number, MessageHandler>();

  // settle() from the connect() promise — called once after ACCOUNT_AUTH_RES
  private settle: ((err?: Error) => void) | null = null;

  constructor(cfg: CTraderSessionConfig) {
    this.cfg         = cfg;
    this.accessToken = cfg.accessToken;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  get accountId():   number | null { return this._accountId; }
  get traderLogin(): number | null { return this._traderLogin; }
  get brokerName():  string | null { return this._brokerName; }
  get isLive():      boolean       { return this._isLive; }

  /**
   * Register a handler for a specific cTrader payload type.
   * Call before connect() so handlers are in place before any messages arrive.
   * Only one handler per payloadType — subsequent calls overwrite the previous.
   */
  onMessage(payloadType: number, handler: MessageHandler): void {
    this.handlers.set(payloadType, handler);
  }

  /**
   * Send a message on the authenticated WebSocket. Returns the clientMsgId
   * attached to the message so callers can correlate responses (e.g. for
   * bar requests). Logs a warning and no-ops if the socket is not open.
   */
  send(msg: Omit<CTraderMessage, 'clientMsgId'>): string {
    const clientMsgId = String(++this.msgCounter);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('Attempted to send while WebSocket not open', { payloadType: msg.payloadType });
      return clientMsgId;
    }
    const full: CTraderMessage = { clientMsgId, ...msg };
    this.ws.send(JSON.stringify(full));
    return clientMsgId;
  }

  /**
   * Opens the WebSocket and drives the three-step auth handshake. Resolves
   * after ACCOUNT_AUTH_RES — the session is fully authenticated and ready
   * for consumers to start their own protocol flows via send().
   */
  async connect(): Promise<void> {
    if (this.cfg.refreshToken && this.cfg.tokenExpiresAt !== undefined) {
      const secsUntilExpiry = this.cfg.tokenExpiresAt - Math.floor(Date.now() / 1000);
      if (secsUntilExpiry < REFRESH_BUFFER_SECS) {
        log.info('Access token near or past expiry — refreshing before connect', { secsUntilExpiry });
        await this.refreshAccessToken();
      }
    }

    return new Promise((resolve, reject) => {
      const wsUrl = this.cfg.wsUrl ?? DEFAULT_WS_URL;
      log.info('Connecting to cTrader Open API', { url: wsUrl });

      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      let settled = false;
      this.settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        this.settle = null;
        if (err) {
          reject(err);
        } else {
          if (!this.cfg.noHeartbeat) this.startHeartbeat();
          resolve();
        }
      };

      ws.on('open', () => {
        log.debug('WebSocket open — sending app auth');
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
          log.warn('Received non-JSON message from cTrader — ignoring');
          return;
        }
        this.handleMessage(msg);
      });

      ws.on('error', (err: Error) => {
        log.error('WebSocket error', { message: err.message });
        this.settle?.(err);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        log.info('WebSocket closed', { code, reason: reason.toString() });
        this.stopHeartbeat();
        this.settle?.(new Error(`WebSocket closed before ready (code ${code})`));
      });
    });
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
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

  // ── Handshake ──────────────────────────────────────────────────────────────

  private handleMessage(msg: CTraderMessage): void {
    log.debug('Received message', { payloadType: msg.payloadType, clientMsgId: msg.clientMsgId });

    switch (msg.payloadType) {

      case PT.APP_AUTH_RES: {
        log.debug('App auth OK — requesting account list');
        this.send({
          payloadType: PT.GET_ACCOUNTS_REQ,
          payload: { accessToken: this.accessToken },
        });
        break;
      }

      case PT.GET_ACCOUNTS_RES: {
        const accounts = (msg.payload?.ctidTraderAccount ?? []) as CTraderAccount[];
        log.debug('Account list received', { count: accounts.length });

        const account = this.cfg.accountId
          ? accounts.find(a => a.ctidTraderAccountId === this.cfg.accountId)
          : accounts.find(a => a.isLive) ?? accounts[0];

        if (!account) {
          this.settle?.(new Error('No matching cTrader account found for the provided access token'));
          return;
        }

        this._accountId   = account.ctidTraderAccountId;
        this._traderLogin = account.traderLogin;
        this._brokerName  = account.brokerTitleShort ?? null;
        this._isLive      = account.isLive;
        log.info('Using account', {
          accountId:  this._accountId,
          login:      account.traderLogin,
          isLive:     account.isLive,
          brokerName: account.brokerTitleShort,
        });

        this.send({
          payloadType: PT.ACCOUNT_AUTH_REQ,
          payload: {
            ctidTraderAccountId: this._accountId,
            accessToken:         this.accessToken,
          },
        });
        break;
      }

      case PT.ACCOUNT_AUTH_RES: {
        // Auth handshake complete. Dispatch to consumer handler (if any) first,
        // then resolve connect() — consumer may send follow-up messages in its
        // handler (e.g. SYMBOL_LIST_REQ) and these must be queued before resolve.
        const handler = this.handlers.get(PT.ACCOUNT_AUTH_RES);
        if (handler) handler(msg);
        this.settle?.();
        break;
      }

      case PT.HEARTBEAT: {
        this.send({ payloadType: PT.HEARTBEAT });
        break;
      }

      case PT.ERROR_RES: {
        const errorCode   = msg.payload?.errorCode   ?? 'UNKNOWN';
        const description = String(msg.payload?.description ?? '');

        // Demo servers reject payloadType 0 (heartbeat). Stop sending and carry on.
        if (description.includes('payloadType: 0')) {
          log.warn('Server rejected heartbeat (payloadType 0) — disabling client heartbeats');
          this.stopHeartbeat();
          break;
        }

        // If we haven't settled yet, this error aborts the handshake.
        if (this.settle) {
          log.error('cTrader API error during handshake', { errorCode, description });
          this.settle(new Error(`cTrader error ${errorCode}: ${description}`));
          break;
        }

        // Known demo-server noise: the broker pushes these events internally
        // after account auth but demo environments don't support them.
        // Suppress at warn level rather than surfacing as errors.
        const DEMO_NOISE = ['SymbolsForConversion', 'ProtoOASymbolChangedEvent'];
        if (DEMO_NOISE.some(s => description.includes(s))) {
          log.warn('Ignoring unsupported demo server event', { errorCode, description });
          break;
        }

        // Post-auth: dispatch to consumer error handler, or log and continue.
        const handler = this.handlers.get(PT.ERROR_RES);
        if (handler) {
          handler(msg);
        } else {
          log.error('cTrader API error', { errorCode, description });
        }
        break;
      }

      default: {
        const handler = this.handlers.get(msg.payloadType);
        if (handler) {
          handler(msg);
        } else {
          log.debug('Unhandled payloadType', { payloadType: msg.payloadType });
        }
      }
    }
  }

  // ── Token refresh ──────────────────────────────────────────────────────────

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
      refreshToken: tokens.refreshToken ?? this.cfg.refreshToken,
      expiresAt,
    });
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────────

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
