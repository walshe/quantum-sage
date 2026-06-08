import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { CTraderOrderExecutor } from '../../src/trader/CTraderOrderExecutor.js';
import { PT } from '../../src/price-feed/CTraderSession.js';
import type { QSConfig } from '../../src/config/types.js';

// ── Mock WebSocket (same pattern as other trader tests) ───────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function serverSend(payloadType: number, payload: Record<string, unknown> = {}) {
  mockWs.emit('message', Buffer.from(JSON.stringify({ payloadType, payload })));
}

function driveHandshake() {
  serverSend(PT.APP_AUTH_RES);
  serverSend(PT.GET_ACCOUNTS_RES, {
    ctidTraderAccount: [{ ctidTraderAccountId: 123, isLive: false, traderLogin: 999 }],
  });
  serverSend(PT.ACCOUNT_AUTH_RES);
}

const BASE_CONFIG = {
  clientId: 'c', clientSecret: 's', accessToken: 'a',
  symbolId: 2549,
  noHeartbeat: true,
};

const QS_CONFIG: QSConfig = {
  capital: { starting_capital_eur: 80_000, daily_risk_pct: 0.5 },
  trident: {
    entry_1_allocation_pct: 32.5,
    entry_2_allocation_pct: 35,
    entry_3_allocation_pct: 32.5,
    midpoint_offset_buy: 2,
    midpoint_offset_sell: -2,
    stop_loss_points: 40,
    breakeven_trigger_points: 25,
    hard_profit_exit_points: 33,
    time_exit_minutes: 180,
    dvs_gate: 75,
  },
  size_adaptation: { after_one_loss_day: 0.5, after_two_loss_days: 0.25 },
  signal: { watch_dir: './setups', stale_threshold_hours: 6, vwap_staleness_warn_minutes: 90 },
  execution: { auto_execute: true, point_value_eur: 1 },
};

function parseSent(ws: MockWs, idx = -1) {
  const msgs = ws.sent;
  return JSON.parse(msgs.at(idx) ?? '{}');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CTraderOrderExecutor', () => {
  let executor: CTraderOrderExecutor;

  beforeEach(() => {
    mockWs = new MockWs();
    executor = new CTraderOrderExecutor(BASE_CONFIG, QS_CONFIG);
  });

  describe('ENTRY_TRIGGERED', () => {
    it('places a MARKET BUY order for a long entry', async () => {
      const connectPromise = executor.connect();
      driveHandshake();
      await connectPromise;

      await executor.notify({
        type: 'ENTRY_TRIGGERED',
        entryNumber: 1,
        price: 7590.5,
        direction: 'long',
        allocationPct: 32.5,
        avgEntry: 7590.5,
        currentStop: 7550.5,
        vwapTarget: 7617.6,
        fillsRemaining: 2,
      });

      const order = parseSent(mockWs);
      expect(order.payloadType).toBe(PT.NEW_ORDER_REQ);
      expect(order.payload.orderType).toBe('MARKET');
      expect(order.payload.tradeSide).toBe('BUY');
      // computeVolume: floor(80000 × 0.005 × 0.325 / (40 × 1)) = floor(3.25) = 3
      // apiVolume = 3 × 100 = 300
      expect(order.payload.volume).toBe(300);
    });

    it('places a MARKET SELL order for a short entry', async () => {
      const connectPromise = executor.connect();
      driveHandshake();
      await connectPromise;

      await executor.notify({
        type: 'ENTRY_TRIGGERED',
        entryNumber: 1,
        price: 7647.5,
        direction: 'short',
        allocationPct: 32.5,
        avgEntry: 7647.5,
        currentStop: 7687.5,
        vwapTarget: 7617.6,
        fillsRemaining: 2,
      });

      const order = parseSent(mockWs);
      expect(order.payload.tradeSide).toBe('SELL');
    });

    it('emits ORDER_FAILED when computed volume is 0', async () => {
      const smallCapConfig: QSConfig = {
        ...QS_CONFIG,
        capital: { starting_capital_eur: 100, daily_risk_pct: 0.5 },
        execution: { auto_execute: true, point_value_eur: 1 },
      };
      executor = new CTraderOrderExecutor(BASE_CONFIG, smallCapConfig);

      const connectPromise = executor.connect();
      driveHandshake();
      await connectPromise;

      const failedReasons: string[] = [];
      executor.setOrderFailedCallback(reason => failedReasons.push(reason));

      await executor.notify({
        type: 'ENTRY_TRIGGERED',
        entryNumber: 1,
        price: 7590.5,
        direction: 'long',
        allocationPct: 32.5,
        avgEntry: 7590.5,
        currentStop: 7550.5,
        vwapTarget: null,
        fillsRemaining: 2,
      });

      expect(failedReasons).toContain('computed volume is zero');
    });
  });

  describe('BREAKEVEN_TRIGGERED', () => {
    it('sends AMEND_POSITION_SLTP_REQ with new stop after positionId is known', async () => {
      const connectPromise = executor.connect();
      driveHandshake();
      await connectPromise;

      // Fire an entry to set up state
      await executor.notify({
        type: 'ENTRY_TRIGGERED',
        entryNumber: 1,
        price: 7590.5,
        direction: 'long',
        allocationPct: 32.5,
        avgEntry: 7590.5,
        currentStop: 7550.5,
        vwapTarget: 7617.6,
        fillsRemaining: 2,
      });

      // Simulate execution event giving us a positionId
      serverSend(PT.EXECUTION_EVENT, {
        executionType: 'ORDER_FILLED',
        position: { positionId: 999 },
      });

      // Now send BREAKEVEN
      await executor.notify({ type: 'BREAKEVEN_TRIGGERED', newStop: 7590.5 });

      const last = parseSent(mockWs);
      expect(last.payloadType).toBe(PT.AMEND_POSITION_SLTP_REQ);
      expect(last.payload.positionId).toBe(999);
      expect(last.payload.stopLoss).toBe(7590.5);
    });
  });

  describe('POSITION_CLOSED', () => {
    it('sends CLOSE_POSITION_REQ with positionId and accumulated volume', async () => {
      const connectPromise = executor.connect();
      driveHandshake();
      await connectPromise;

      await executor.notify({
        type: 'ENTRY_TRIGGERED',
        entryNumber: 1,
        price: 7590.5,
        direction: 'long',
        allocationPct: 32.5,
        avgEntry: 7590.5,
        currentStop: 7550.5,
        vwapTarget: 7617.6,
        fillsRemaining: 2,
      });

      serverSend(PT.EXECUTION_EVENT, {
        executionType: 'ORDER_FILLED',
        position: { positionId: 42 },
      });

      await executor.notify({
        type: 'POSITION_CLOSED',
        reason: 'vwap',
        direction: 'long',
        avgEntry: 7590.5,
        closePrice: 7617.6,
        pnlPoints: 27.1,
      });

      const last = parseSent(mockWs);
      expect(last.payloadType).toBe(PT.CLOSE_POSITION_REQ);
      expect(last.payload.positionId).toBe(42);
    });

    it('does not send close if no positionId is stored', async () => {
      const connectPromise = executor.connect();
      driveHandshake();
      await connectPromise;

      const sentBefore = mockWs.sent.length;

      await executor.notify({
        type: 'POSITION_CLOSED',
        reason: 'stop',
        direction: 'long',
        avgEntry: 7590.5,
        closePrice: 7550.5,
        pnlPoints: -40,
      });

      expect(mockWs.sent.length).toBe(sentBefore); // no new message sent
    });
  });

  describe('ORDER_FAILED on broker error', () => {
    it('fires the callback when ERROR_RES is received', async () => {
      const connectPromise = executor.connect();
      driveHandshake();
      await connectPromise;

      const failures: string[] = [];
      executor.setOrderFailedCallback(r => failures.push(r));

      serverSend(PT.ERROR_RES, { description: 'Insufficient margin' });

      expect(failures.length).toBeGreaterThan(0);
    });

    it('fires callback for ORDER_REJECTED execution event', async () => {
      const connectPromise = executor.connect();
      driveHandshake();
      await connectPromise;

      const failures: string[] = [];
      executor.setOrderFailedCallback(r => failures.push(r));

      serverSend(PT.EXECUTION_EVENT, { executionType: 'ORDER_REJECTED', order: {} });

      expect(failures.length).toBeGreaterThan(0);
    });
  });
});
