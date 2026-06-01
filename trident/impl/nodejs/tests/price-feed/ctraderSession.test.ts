import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { CTraderSession, PT } from '../../src/price-feed/CTraderSession.js';
import type { CTraderSessionConfig } from '../../src/price-feed/CTraderSession.js';

// ── Minimal WebSocket mock ───────────────────────────────────────────────────

class MockWs extends EventEmitter {
  readyState = 1; // OPEN
  sent: string[] = [];
  send(data: string) { this.sent.push(data); }
  close() { this.emit('close', 1000, Buffer.from('')); }
}

let mockWs: MockWs;

// Intercept the `ws` import so CTraderSession uses our mock
vi.mock('ws', () => ({
  default: class {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1;
    _emitter = mockWs;
    send(data: string) { mockWs.send(data); }
    on(event: string, handler: (...args: unknown[]) => void) { mockWs.on(event, handler); }
    once(event: string, handler: (...args: unknown[]) => void) { mockWs.once(event, handler); }
    close() { mockWs.close(); }
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE_CFG: CTraderSessionConfig = {
  clientId:     'test-client',
  clientSecret: 'test-secret',
  accessToken:  'test-token',
};

function makeCfg(overrides: Partial<CTraderSessionConfig> = {}): CTraderSessionConfig {
  return { ...BASE_CFG, ...overrides };
}

/** Parse the Nth outbound message sent by the session. */
function sentMsg(n: number): { payloadType: number; payload?: Record<string, unknown> } {
  return JSON.parse(mockWs.sent[n]) as { payloadType: number; payload?: Record<string, unknown> };
}

/** Simulate the server sending a message back to the session. */
function serverSend(payloadType: number, payload: Record<string, unknown> = {}): void {
  mockWs.emit('message', Buffer.from(JSON.stringify({ payloadType, payload })));
}

const ACCOUNTS_LIVE = [{ ctidTraderAccountId: 999, isLive: true, traderLogin: 1234 }];
const ACCOUNTS_DEMO = [{ ctidTraderAccountId: 888, isLive: false, traderLogin: 5678 }];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CTraderSession — auth handshake', () => {
  beforeEach(() => {
    mockWs = new MockWs();
  });

  it('sends APP_AUTH_REQ on open, then GET_ACCOUNTS_REQ on APP_AUTH_RES', async () => {
    const session = new CTraderSession(makeCfg({ noHeartbeat: true }));
    const connectPromise = session.connect();

    // WebSocket open event triggers APP_AUTH_REQ
    mockWs.emit('open');
    expect(sentMsg(0).payloadType).toBe(PT.APP_AUTH_REQ);
    expect(sentMsg(0).payload?.clientId).toBe('test-client');

    // APP_AUTH_RES triggers GET_ACCOUNTS_REQ
    serverSend(PT.APP_AUTH_RES);
    expect(sentMsg(1).payloadType).toBe(PT.GET_ACCOUNTS_REQ);
    expect(sentMsg(1).payload?.accessToken).toBe('test-token');

    // GET_ACCOUNTS_RES triggers ACCOUNT_AUTH_REQ with the live account
    serverSend(PT.GET_ACCOUNTS_RES, { ctidTraderAccount: ACCOUNTS_LIVE });
    expect(sentMsg(2).payloadType).toBe(PT.ACCOUNT_AUTH_REQ);
    expect(sentMsg(2).payload?.ctidTraderAccountId).toBe(999);

    // ACCOUNT_AUTH_RES resolves connect()
    serverSend(PT.ACCOUNT_AUTH_RES);
    await connectPromise;

    expect(session.accountId).toBe(999);
  });

  it('selects the first live account when no accountId is configured', async () => {
    const session = new CTraderSession(makeCfg({ noHeartbeat: true }));
    const connectPromise = session.connect();

    mockWs.emit('open');
    serverSend(PT.APP_AUTH_RES);
    serverSend(PT.GET_ACCOUNTS_RES, { ctidTraderAccount: ACCOUNTS_LIVE });
    serverSend(PT.ACCOUNT_AUTH_RES);
    await connectPromise;

    expect(session.accountId).toBe(999);
  });

  it('falls back to accounts[0] when no live account exists (demo environment)', async () => {
    const session = new CTraderSession(makeCfg({ noHeartbeat: true }));
    const connectPromise = session.connect();

    mockWs.emit('open');
    serverSend(PT.APP_AUTH_RES);
    serverSend(PT.GET_ACCOUNTS_RES, { ctidTraderAccount: ACCOUNTS_DEMO });
    serverSend(PT.ACCOUNT_AUTH_RES);
    await connectPromise;

    expect(session.accountId).toBe(888);
  });

  it('uses configured accountId when provided', async () => {
    const session = new CTraderSession(makeCfg({ accountId: 888, noHeartbeat: true }));
    const connectPromise = session.connect();

    mockWs.emit('open');
    serverSend(PT.APP_AUTH_RES);
    // Both accounts in list — should pick 888
    serverSend(PT.GET_ACCOUNTS_RES, {
      ctidTraderAccount: [...ACCOUNTS_LIVE, ...ACCOUNTS_DEMO],
    });
    serverSend(PT.ACCOUNT_AUTH_RES);
    await connectPromise;

    expect(session.accountId).toBe(888);
  });

  it('rejects connect() when no matching account is found', async () => {
    const session = new CTraderSession(makeCfg({ accountId: 999999, noHeartbeat: true }));
    const connectPromise = session.connect();

    mockWs.emit('open');
    serverSend(PT.APP_AUTH_RES);
    serverSend(PT.GET_ACCOUNTS_RES, { ctidTraderAccount: ACCOUNTS_LIVE });

    await expect(connectPromise).rejects.toThrow('No matching cTrader account');
  });

  it('rejects connect() on ERROR_RES during handshake', async () => {
    const session = new CTraderSession(makeCfg({ noHeartbeat: true }));
    const connectPromise = session.connect();

    mockWs.emit('open');
    serverSend(PT.APP_AUTH_RES);
    serverSend(PT.ERROR_RES, { errorCode: 'AUTH_FAILED', description: 'invalid credentials' });

    await expect(connectPromise).rejects.toThrow('AUTH_FAILED');
  });

  it('dispatches registered consumer handlers after auth', async () => {
    const session = new CTraderSession(makeCfg({ noHeartbeat: true }));
    const received: number[] = [];
    session.onMessage(2999, msg => received.push(msg.payloadType));

    const connectPromise = session.connect();
    mockWs.emit('open');
    serverSend(PT.APP_AUTH_RES);
    serverSend(PT.GET_ACCOUNTS_RES, { ctidTraderAccount: ACCOUNTS_LIVE });
    serverSend(PT.ACCOUNT_AUTH_RES);
    await connectPromise;

    serverSend(2999);
    expect(received).toEqual([2999]);
  });

  it('send() returns the clientMsgId used', async () => {
    const session = new CTraderSession(makeCfg({ noHeartbeat: true }));
    const connectPromise = session.connect();
    mockWs.emit('open');
    serverSend(PT.APP_AUTH_RES);
    serverSend(PT.GET_ACCOUNTS_RES, { ctidTraderAccount: ACCOUNTS_LIVE });
    serverSend(PT.ACCOUNT_AUTH_RES);
    await connectPromise;

    const msgId = session.send({ payloadType: 9999 });
    const lastSent = JSON.parse(mockWs.sent[mockWs.sent.length - 1]) as { clientMsgId: string };
    expect(lastSent.clientMsgId).toBe(msgId);
  });
});
