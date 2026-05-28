import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CTraderPriceFeed, type OhlcvBar } from '../../src/price-feed/CTraderPriceFeed.js';
import { startWebServer, type WebServerHandle } from '../../src/web/server.js';
import type { QSConfig } from '../../src/config/types.js';
import type { Bootstrap } from '../../src/notifier/WebSocketNotifier.js';
import WebSocket from 'ws';

// ── Test fixtures ────────────────────────────────────────────────────────────

const BARS: OhlcvBar[] = [
  { open: 5005, high: 5015, low: 5000, close: 5010, volume: 100, timestamp: 1_700_000_000_000 },
  { open: 5012, high: 5025, low: 5010, close: 5020, volume: 200, timestamp: 1_700_000_060_000 },
];
// VWAP = Σ((H+L+C)/3 × V) / ΣV
// Bar 1: typical = (5015+5000+5010)/3 = 5008.333..., contribution = 500833.33...
// Bar 2: typical = (5025+5010+5020)/3 = 5018.333..., contribution = 1003666.67...
// total volume = 300, VWAP = 1504500 / 300 = 5015.00
const EXPECTED_VWAP = 5015.00;

const BARS_ZERO_VOL: OhlcvBar[] = [
  { open: 5005, high: 5015, low: 5000, close: 5010, volume: 0, timestamp: 1_700_000_000_000 },
  { open: 5012, high: 5025, low: 5010, close: 5020, volume: 0, timestamp: 1_700_000_060_000 },
];
// volumeWarning path: simple typical-price average = (5008.333 + 5018.333) / 2 = 5013.33
const EXPECTED_VWAP_ZERO_VOL = 5013.33;

const config: QSConfig = {
  capital: { starting_capital_eur: 80000, daily_risk_pct: 0.5 },
  trident: {
    entry_1_allocation_pct: 32.5, entry_2_allocation_pct: 35.0, entry_3_allocation_pct: 32.5,
    midpoint_offset_buy: 2, midpoint_offset_sell: -2, stop_loss_points: 40,
    breakeven_trigger_points: 25, hard_profit_exit_points: 33, time_exit_minutes: 180, dvs_gate: 75,
  },
  size_adaptation: { after_one_loss_day: 0.5, after_two_loss_days: 0.25 },
  signal: { watch_dir: './signals', stale_threshold_hours: 6, vwap_staleness_warn_minutes: 90 },
};

const bootstrap: Bootstrap = {
  serverTime: '2026-05-12T10:00:00.000Z',
  state: 'idle', dailyLocked: false, symbol: 'US500', lastIdleReason: null, currentSignal: null, position: null,
};

function makeFeed(bars: OhlcvBar[] | 'timeout' | 'error'): CTraderPriceFeed {
  const feed = new CTraderPriceFeed({
    clientId: 'c', clientSecret: 's', accessToken: 'a', symbolName: 'US500',
  });
  if (bars === 'timeout') {
    vi.spyOn(feed, 'getTodayBars').mockRejectedValue(new Error('bar request timed out'));
  } else if (bars === 'error') {
    vi.spyOn(feed, 'getTodayBars').mockRejectedValue(new Error('cTrader error CH_NOT_CONNECTED: not connected'));
  } else {
    vi.spyOn(feed, 'getTodayBars').mockResolvedValue(bars);
  }
  return feed;
}

// ── CTraderPriceFeed unit tests ──────────────────────────────────────────────

describe('CTraderPriceFeed — getTodayBars()', () => {
  it('throws "feed not connected" when WebSocket is not open', async () => {
    const feed = new CTraderPriceFeed({
      clientId: 'c', clientSecret: 's', accessToken: 'a', symbolName: 'US500',
    });
    await expect(feed.getTodayBars()).rejects.toThrow('feed not connected');
  });

  it('throws "feed not connected" when accountId is null (handshake incomplete)', async () => {
    const feed = new CTraderPriceFeed({
      clientId: 'c', clientSecret: 's', accessToken: 'a', symbolName: 'US500',
    });
    // Attach a fake open WebSocket but leave accountId null
    (feed as unknown as Record<string, unknown>)['ws'] = { readyState: WebSocket.OPEN, send: () => {} };
    await expect(feed.getTodayBars()).rejects.toThrow('feed not connected');
  });

  it('sends GET_TRENDBAR_REQ and resolves via pending map', async () => {
    const feed = new CTraderPriceFeed({
      clientId: 'c', clientSecret: 's', accessToken: 'a', symbolName: 'US500',
    });

    const sentMessages: string[] = [];
    const fakeWs = { readyState: WebSocket.OPEN, send: (m: string) => sentMessages.push(m) };
    const feedAny = feed as unknown as Record<string, unknown>;
    feedAny['ws']        = fakeWs;
    feedAny['accountId'] = 12345;
    feedAny['symbolId']  = 42;

    const barsPromise = feed.getTodayBars();

    // Verify the outbound message
    expect(sentMessages.length).toBe(1);
    const sent = JSON.parse(sentMessages[0]) as { payloadType: number; clientMsgId: string };
    expect(sent.payloadType).toBe(2137);
    const msgId = sent.clientMsgId;

    // Simulate the response by resolving the pending entry directly
    // (in production, handleMessage() does this; here we bypass the wire)
    const pending = (feedAny['pendingBarRequests'] as Map<string, { resolve: (v: OhlcvBar[]) => void }>).get(msgId);
    expect(pending).toBeDefined();
    pending!.resolve(BARS);

    const result = await barsPromise;
    expect(result).toHaveLength(2);
    expect(result[0].volume).toBe(100);
    expect(result[1].close).toBe(5020);
  });

  it('rejects after 10 s timeout when no response arrives', async () => {
    vi.useFakeTimers();
    const feed = new CTraderPriceFeed({
      clientId: 'c', clientSecret: 's', accessToken: 'a', symbolName: 'US500',
    });
    const feedAny = feed as unknown as Record<string, unknown>;
    feedAny['ws']        = { readyState: WebSocket.OPEN, send: () => {} };
    feedAny['accountId'] = 12345;
    feedAny['symbolId']  = 42;

    const barsPromise = feed.getTodayBars();
    vi.advanceTimersByTime(10_001);

    await expect(barsPromise).rejects.toThrow('bar request timed out');
    vi.useRealTimers();
  });
});

// ── GET /api/vwap server tests ───────────────────────────────────────────────

describe('web server — GET /api/vwap', () => {
  let tmp: string;
  let handle: WebServerHandle;
  let baseUrl: string;

  async function startWith(feed: CTraderPriceFeed | null): Promise<void> {
    tmp = mkdtempSync(join(tmpdir(), 'trident-vwap-'));
    handle = await startWebServer({
      port: 0,
      config,
      signalsDir: join(tmp, 'signals'),
      publicDir: join(tmp, 'public'),
      getBootstrap: () => bootstrap,
      getPriceFeed: feed ? () => feed : undefined,
    });
    baseUrl = `http://localhost:${handle.port}`;
  }

  afterEach(async () => {
    await handle.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns 503 when no priceFeed is configured', async () => {
    await startWith(null);
    const res = await fetch(`${baseUrl}/api/vwap`);
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('feed not connected');
  });

  it('returns 503 with timeout message when getTodayBars times out', async () => {
    await startWith(makeFeed('timeout'));
    const res = await fetch(`${baseUrl}/api/vwap`);
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('timed out');
  });

  it('returns 200 with correct VWAP for a known bar set', async () => {
    await startWith(makeFeed(BARS));
    const res = await fetch(`${baseUrl}/api/vwap`);
    expect(res.status).toBe(200);
    const body = await res.json() as { vwap: number; barsUsed: number; asOf: string; volumeWarning?: boolean };
    expect(body.vwap).toBe(EXPECTED_VWAP);
    expect(body.barsUsed).toBe(2);
    expect(typeof body.asOf).toBe('string');
    expect(body.volumeWarning).toBeUndefined();
  });

  it('returns 200 with volumeWarning:true when all bars have zero volume', async () => {
    await startWith(makeFeed(BARS_ZERO_VOL));
    const res = await fetch(`${baseUrl}/api/vwap`);
    expect(res.status).toBe(200);
    const body = await res.json() as { vwap: number; barsUsed: number; volumeWarning?: boolean };
    expect(body.vwap).toBe(EXPECTED_VWAP_ZERO_VOL);
    expect(body.volumeWarning).toBe(true);
  });

  it('returns 503 with "no bars available" when getTodayBars returns empty array', async () => {
    await startWith(makeFeed([]));
    const res = await fetch(`${baseUrl}/api/vwap`);
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('no bars available');
  });
});
