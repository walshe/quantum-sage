/**
 * src/trader/CTraderTrader.ts
 *
 * Fetches live account balance and equity from the cTrader Open API.
 *
 * Owns its own CTraderSession (C2 design — independent connection from the
 * price feed so a drop on one side doesn't affect the other). After account
 * auth it fires a ProtoOATraderReq (2120) to get balance and equity, then
 * polls every 30 seconds to keep the values fresh.
 *
 * Account data is surfaced via an onAccountUpdate callback so callers
 * (index.ts) can push it into the notifier pipeline and on to the UI.
 */

import { CTraderSession, PT } from '../price-feed/CTraderSession.js';
import type { CTraderSessionConfig } from '../price-feed/CTraderSession.js';
import { getLogger } from '../logger.js';

const log = getLogger('CTraderTrader');

const POLL_INTERVAL_MS = 30_000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface AccountInfo {
  balance:        number;
  equity:         number;
  unrealizedPnl:  number;
  currency:       string;
}

export interface AccountMeta {
  login:      number;
  brokerName: string;
  isLive:     boolean;
}

export interface CTraderTraderConfig extends CTraderSessionConfig {
  onAccountUpdate:  (info: AccountInfo) => void;
  /** Called immediately after account auth, before TRADER_RES arrives. */
  onAccountMeta?:   (meta: AccountMeta) => void;
  /** Override the poll interval (ms). Defaults to 30 000. */
  pollIntervalMs?: number;
}

// ── CTraderTrader ─────────────────────────────────────────────────────────────

export class CTraderTrader {
  private readonly cfg:     CTraderTraderConfig;
  private readonly session: CTraderSession;

  private pollTimer:    ReturnType<typeof setInterval> | null = null;
  private lastBalance:  number | null = null;
  private lastEquity:   number | null = null;
  private firstResponse = true;

  constructor(cfg: CTraderTraderConfig) {
    this.cfg     = cfg;
    this.session = new CTraderSession(cfg);
  }

  async connect(): Promise<void> {
    this.session.onMessage(PT.ACCOUNT_AUTH_RES, () => {
      this.sendTraderReq();
    });

    this.session.onMessage(PT.TRADER_RES, msg => {
      this.handleTraderRes(msg.payload ?? {});
    });

    await this.session.connect();

    // Fire metadata immediately — broker name and login are known from the
    // handshake regardless of whether TRADER_RES ever arrives (e.g. demo servers).
    this.cfg.onAccountMeta?.({
      login:      this.session.traderLogin ?? 0,
      brokerName: this.session.brokerName  ?? '',
      isLive:     this.session.isLive,
    });
  }

  async disconnect(): Promise<void> {
    this.stopPoll();
    await this.session.disconnect();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private sendTraderReq(): void {
    if (this.session.accountId === null) return;
    this.session.send({
      payloadType: PT.TRADER_REQ,
      payload: { ctidTraderAccountId: this.session.accountId },
    });
    log.debug('Sent TRADER_REQ', { accountId: this.session.accountId });

    // Note: some broker demo servers (e.g. Pepperstone via demo.ctraderapi.com)
    // do not respond to TRADER_REQ. In that case the balance chip stays at the
    // value seeded from CTRADER_ACCOUNT_BALANCE in .env (or — if unset).
    // TRADER_RES will override the seeded value when it arrives (live accounts).
  }

  private handleTraderRes(payload: Record<string, unknown>): void {
    // The cTrader JSON API wraps the trader object in a `trader` field.
    // Log the raw payload on the first response so field names can be verified.
    if (this.firstResponse) {
      log.info('TRADER_RES raw payload (first response — verify field names)', {
        payload: JSON.stringify(payload),
      });
      this.firstResponse = false;
    }

    const trader = (payload['trader'] ?? payload) as Record<string, unknown>;

    // moneyDigits determines the decimal factor for monetary integers.
    // Typically 2 (i.e. divide by 100) for EUR/USD accounts.
    const moneyDigits  = (trader['moneyDigits'] as number | undefined) ?? 2;
    const divisor      = Math.pow(10, moneyDigits);

    const balanceRaw = trader['balance'] as number | undefined;
    if (balanceRaw === undefined) {
      log.warn('TRADER_RES missing balance field — skipping update', { trader });
      return;
    }

    const balance = balanceRaw / divisor;

    // equity = balance + unrealized P&L. Some API versions include it directly;
    // others don't. Fall back to balance (unrealizedPnl = 0) if absent.
    const equityRaw = trader['equity'] as number | undefined;
    const equity    = equityRaw !== undefined ? equityRaw / divisor : balance;

    const unrealizedPnl = Math.round((equity - balance) * 100) / 100;

    // Currency: try common field names, default to EUR (FB's account currency).
    const currency = (
      (trader['currency']       as string | undefined) ??
      (trader['depositAsset']   as string | undefined) ??
      'EUR'
    );

    log.info('Account update', { balance, equity, unrealizedPnl, currency });

    // Only fire the callback if values have changed (avoids noisy updates on polls).
    const changed = balance !== this.lastBalance || equity !== this.lastEquity;
    this.lastBalance = balance;
    this.lastEquity  = equity;

    if (changed) {
      this.cfg.onAccountUpdate({
        balance, equity, unrealizedPnl, currency,
        login:      this.session.traderLogin ?? 0,
        brokerName: this.session.brokerName  ?? '',
        isLive:     this.session.isLive,
      });
    }

    // Start the poll after the first successful response.
    if (this.pollTimer === null) {
      this.startPoll();
    }
  }

  private startPoll(): void {
    const intervalMs = this.cfg.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.pollTimer = setInterval(() => {
      if (this.session.accountId !== null) {
        this.sendTraderReq();
      }
    }, intervalMs);
  }

  private stopPoll(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
