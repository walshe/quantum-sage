import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { CTraderTrader } from '../../src/trader/CTraderTrader.js';
import type { CTraderTraderConfig } from '../../src/trader/CTraderTrader.js';
import type { AccountInfo } from '../../src/notifier/Notifier.js';
import { PT } from '../../src/price-feed/CTraderSession.js';

// ── Mock WebSocket (same pattern as ctraderSession.test.ts) ─────────────────

class MockWs extends EventEmitter {
  readyState = 1;
  sent: string[] = [];
  send(data: string) { this.sent.push(data); }
  close() { this.emit('close', 1000, Buffer.from('')); }
}

let mockWs: MockWs;

vi.mock('ws', () => ({
  default: class {
    static OPEN   = 1;
    static CLOSED = 3;
    readyState = 1;
    send(data: string)   { mockWs.send(data); }
    on(e: string, h: (...a: unknown[]) => void)   { mockWs.on(e, h); }
    once(e: string, h: (...a: unknown[]) => void) { mockWs.once(e, h); }
    close() { mockWs.close(); }
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE_CFG: Omit<CTraderTraderConfig, 'onAccountUpdate'> = {
  clientId: 'c', clientSecret: 's', accessToken: 'a',
  noHeartbeat: true,
};

function serverSend(payloadType: number, payload: Record<string, unknown> = {}) {
  mockWs.emit('message', Buffer.from(JSON.stringify({ payloadType, payload })));
}

function driveHandshake() {
  mockWs.emit('open');
  serverSend(PT.APP_AUTH_RES);
  serverSend(PT.GET_ACCOUNTS_RES, {
    ctidTraderAccount: [{ ctidTraderAccountId: 42, isLive: false, traderLogin: 1 }],
  });
  serverSend(PT.ACCOUNT_AUTH_RES);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CTraderTrader — TRADER_RES decoding', () => {
  beforeEach(() => { mockWs = new MockWs(); });

  it('decodes balance and equity using moneyDigits', async () => {
    const updates: AccountInfo[] = [];
    const trader = new CTraderTrader({
      ...BASE_CFG,
      pollIntervalMs: 999999,
      onAccountUpdate: info => updates.push(info),
    });

    const connectPromise = trader.connect();
    driveHandshake();
    await connectPromise;

    // Simulate TRADER_RES with moneyDigits=2 (÷100)
    serverSend(PT.TRADER_RES, {
      trader: { balance: 10000000, equity: 10012500, moneyDigits: 2, currency: 'EUR' },
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].balance).toBe(100000);
    expect(updates[0].equity).toBe(100125);
    expect(updates[0].unrealizedPnl).toBe(125);
    expect(updates[0].currency).toBe('EUR');

    await trader.disconnect();
  });

  it('falls back to balance when equity is absent (unrealizedPnl = 0)', async () => {
    const updates: AccountInfo[] = [];
    const trader = new CTraderTrader({
      ...BASE_CFG,
      pollIntervalMs: 999999,
      onAccountUpdate: info => updates.push(info),
    });

    const connectPromise = trader.connect();
    driveHandshake();
    await connectPromise;

    serverSend(PT.TRADER_RES, {
      trader: { balance: 5000000, moneyDigits: 2 },
    });

    expect(updates[0].balance).toBe(50000);
    expect(updates[0].equity).toBe(50000);
    expect(updates[0].unrealizedPnl).toBe(0);

    await trader.disconnect();
  });

  it('defaults currency to EUR when not present in response', async () => {
    const updates: AccountInfo[] = [];
    const trader = new CTraderTrader({
      ...BASE_CFG,
      pollIntervalMs: 999999,
      onAccountUpdate: info => updates.push(info),
    });

    const connectPromise = trader.connect();
    driveHandshake();
    await connectPromise;

    serverSend(PT.TRADER_RES, { trader: { balance: 1000000, moneyDigits: 2 } });

    expect(updates[0].currency).toBe('EUR');

    await trader.disconnect();
  });
});

describe('CTraderTrader — onAccountUpdate callback', () => {
  beforeEach(() => { mockWs = new MockWs(); });

  it('does not fire callback when values are unchanged on poll', async () => {
    const updates: AccountInfo[] = [];
    const trader = new CTraderTrader({
      ...BASE_CFG,
      pollIntervalMs: 999999,
      onAccountUpdate: info => updates.push(info),
    });

    const connectPromise = trader.connect();
    driveHandshake();
    await connectPromise;

    const payload = { trader: { balance: 1000000, equity: 1000000, moneyDigits: 2, currency: 'EUR' } };
    serverSend(PT.TRADER_RES, payload);
    expect(updates).toHaveLength(1);

    // Same values again — callback should NOT fire
    serverSend(PT.TRADER_RES, payload);
    expect(updates).toHaveLength(1);

    await trader.disconnect();
  });

  it('fires callback again when values change on poll', async () => {
    const updates: AccountInfo[] = [];
    const trader = new CTraderTrader({
      ...BASE_CFG,
      pollIntervalMs: 999999,
      onAccountUpdate: info => updates.push(info),
    });

    const connectPromise = trader.connect();
    driveHandshake();
    await connectPromise;

    serverSend(PT.TRADER_RES, { trader: { balance: 1000000, equity: 1000000, moneyDigits: 2 } });
    serverSend(PT.TRADER_RES, { trader: { balance: 1000000, equity: 1012500, moneyDigits: 2 } });

    expect(updates).toHaveLength(2);
    expect(updates[1].unrealizedPnl).toBe(125);

    await trader.disconnect();
  });
});

describe('CTraderTrader — poll', () => {
  beforeEach(() => { mockWs = new MockWs(); });

  it('skips poll send when accountId is null (session not connected)', async () => {
    vi.useFakeTimers();
    const trader = new CTraderTrader({
      ...BASE_CFG,
      pollIntervalMs: 1000,
      onAccountUpdate: () => {},
    });

    // Don't connect — accountId stays null
    // Manually start the poll by accessing private internals
    const traderAny = trader as unknown as Record<string, unknown>;
    traderAny['lastBalance'] = 100;
    traderAny['lastEquity']  = 100;

    // Trigger the poll manually — session.accountId is null so no send
    const sentBefore = mockWs.sent.length;
    (traderAny['sendTraderReq'] as () => void).call(trader);
    expect(mockWs.sent.length).toBe(sentBefore); // nothing sent

    vi.useRealTimers();
  });
});
