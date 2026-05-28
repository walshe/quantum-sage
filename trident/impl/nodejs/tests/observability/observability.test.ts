import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NoopBackend } from '../../src/observability/NoopBackend.js';
import { PrometheusBackend } from '../../src/observability/PrometheusBackend.js';
import { MetricsNotifier } from '../../src/observability/MetricsNotifier.js';
import type { MetricsBackend } from '../../src/observability/types.js';
import type { NotificationEvent } from '../../src/notifier/Notifier.js';
import { startWebServer } from '../../src/web/server.js';
import type { QSConfig } from '../../src/config/types.js';
import type { Bootstrap } from '../../src/notifier/WebSocketNotifier.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolve } from 'path';

// ─── NoopBackend ─────────────────────────────────────────────────────────────

describe('NoopBackend', () => {
  it('all methods callable without error', () => {
    const b = new NoopBackend();
    expect(() => {
      b.recordTick(100);
      b.recordSignalLoaded(true);
      b.recordSignalLoaded(false);
      b.recordEngineState('watching');
      b.recordEntry(1, 'long');
      b.recordClose('stop_loss', -10);
      b.recordConnectionState(true);
      b.recordConnectionState(false);
      b.setTickRate(45);
    }).not.toThrow();
  });
});

// ─── PrometheusBackend ───────────────────────────────────────────────────────

describe('PrometheusBackend', () => {
  let backend: PrometheusBackend;

  beforeEach(() => {
    backend = new PrometheusBackend();
  });

  it('exposes a metricsHandler function', () => {
    expect(typeof backend.metricsHandler()).toBe('function');
  });

  it('metrics output contains trident metric names after recording', async () => {
    backend.recordTick(100);
    backend.recordSignalLoaded(true);
    backend.recordEngineState('watching');
    backend.recordEntry(1, 'long');
    backend.recordClose('vwap_hit', 22);
    backend.recordConnectionState(true);
    backend.setTickRate(30);

    const handler = backend.metricsHandler();
    let body = '';
    const fakeReq = {} as Parameters<typeof handler>[0];
    const fakeRes = {
      set: () => {},
      end: (data: string) => { body = data; },
    } as unknown as Parameters<typeof handler>[1];
    await handler(fakeReq, fakeRes);

    expect(body).toContain('trident_ticks_total');
    expect(body).toContain('trident_signal_loads_total');
    expect(body).toContain('trident_engine_state');
    expect(body).toContain('trident_entries_total');
    expect(body).toContain('trident_closes_total');
    expect(body).toContain('trident_pnl_points');
    expect(body).toContain('trident_feed_connected');
    expect(body).toContain('trident_tick_rate');
  });
});

// ─── MetricsNotifier ─────────────────────────────────────────────────────────

class RecordingBackend implements MetricsBackend {
  calls: Array<{ method: string; args: unknown[] }> = [];
  recordTick(price: number) { this.calls.push({ method: 'recordTick', args: [price] }); }
  recordSignalLoaded(valid: boolean) { this.calls.push({ method: 'recordSignalLoaded', args: [valid] }); }
  recordEngineState(state: string) { this.calls.push({ method: 'recordEngineState', args: [state] }); }
  recordEntry(n: number, d: string) { this.calls.push({ method: 'recordEntry', args: [n, d] }); }
  recordClose(r: string, p: number) { this.calls.push({ method: 'recordClose', args: [r, p] }); }
  recordConnectionState(c: boolean) { this.calls.push({ method: 'recordConnectionState', args: [c] }); }
  setTickRate(n: number) { this.calls.push({ method: 'setTickRate', args: [n] }); }
  last(method: string) { return this.calls.filter(c => c.method === method).at(-1); }
}

describe('MetricsNotifier', () => {
  let backend: RecordingBackend;
  let notifier: MetricsNotifier;

  beforeEach(() => {
    backend = new RecordingBackend();
    notifier = new MetricsNotifier(backend);
  });

  it('SIGNAL_LOADED → recordSignalLoaded(true)', async () => {
    await notifier.notify({ type: 'SIGNAL_LOADED', signal: {} as never, filePath: '/f' });
    expect(backend.last('recordSignalLoaded')?.args).toEqual([true]);
  });

  it('SIGNAL_INVALID → recordSignalLoaded(false)', async () => {
    await notifier.notify({ type: 'SIGNAL_INVALID', filePath: '/f', errors: [] });
    expect(backend.last('recordSignalLoaded')?.args).toEqual([false]);
  });

  it('DVS_GATE_BLOCKED → recordEngineState(blocked)', async () => {
    await notifier.notify({ type: 'DVS_GATE_BLOCKED', dvs: 90, gate: 75 });
    expect(backend.last('recordEngineState')?.args).toEqual(['blocked']);
  });

  it('SETUP_READY → recordEngineState(watching)', async () => {
    await notifier.notify({
      type: 'SETUP_READY', direction: 'long',
      entries: [], stopPoints: 40, vwap: 6555,
    });
    expect(backend.last('recordEngineState')?.args).toEqual(['watching']);
  });

  it('ENTRY_TRIGGERED entry 1 → recordEngineState(in_trade) + recordEntry', async () => {
    const event: NotificationEvent = {
      type: 'ENTRY_TRIGGERED', entryNumber: 1, price: 6582, direction: 'short',
      allocationPct: 32.5, avgEntry: 6582, currentStop: 6622, fillsRemaining: 2,
    };
    await notifier.notify(event);
    expect(backend.last('recordEngineState')?.args).toEqual(['in_trade']);
    expect(backend.last('recordEntry')?.args).toEqual([1, 'short']);
  });

  it('ENTRY_TRIGGERED entry 2 → only recordEntry, no state change', async () => {
    const event: NotificationEvent = {
      type: 'ENTRY_TRIGGERED', entryNumber: 2, price: 6597, direction: 'short',
      allocationPct: 35, avgEntry: 6590, currentStop: 6630, fillsRemaining: 1,
    };
    await notifier.notify(event);
    expect(backend.calls.filter(c => c.method === 'recordEngineState')).toHaveLength(0);
    expect(backend.last('recordEntry')?.args).toEqual([2, 'short']);
  });

  it('POSITION_CLOSED → recordEngineState(closed) + recordClose', async () => {
    await notifier.notify({
      type: 'POSITION_CLOSED', reason: 'vwap_hit', direction: 'short',
      avgEntry: 6595, closePrice: 6555, pnlPoints: 40,
    });
    expect(backend.last('recordEngineState')?.args).toEqual(['closed']);
    expect(backend.last('recordClose')?.args).toEqual(['vwap_hit', 40]);
  });
});

// ─── Integration: /metrics endpoint ──────────────────────────────────────────

describe('/metrics integration', () => {
  let handle: Awaited<ReturnType<typeof startWebServer>>;
  let tmpDir: string;

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
    serverTime: new Date().toISOString(),
    state: 'idle', dailyLocked: false, symbol: 'US500', lastIdleReason: null, currentSignal: null, position: null,
  };

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trident-obs-test-'));
    const backend = new PrometheusBackend();
    backend.recordTick(100);
    handle = await startWebServer({
      port: 0,
      config,
      signalsDir: tmpDir,
      publicDir: resolve('src/web/public'),
      getBootstrap: () => bootstrap,
      metricsHandler: backend.metricsHandler(),
    });
  });

  afterEach(async () => {
    await handle.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /metrics returns 200 with trident metric names', async () => {
    const res = await fetch(`http://localhost:${handle.port}/metrics`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('trident_ticks_total');
    expect(body).toContain('trident_feed_connected');
  });

  it('GET /metrics not registered when no metricsHandler provided', async () => {
    const tmpDir2 = mkdtempSync(join(tmpdir(), 'trident-obs-nometrics-'));
    const handle2 = await startWebServer({
      port: 0, config, signalsDir: tmpDir2,
      publicDir: resolve('src/web/public'),
      getBootstrap: () => bootstrap,
    });
    try {
      const res = await fetch(`http://localhost:${handle2.port}/metrics`);
      expect(res.status).toBe(404);
    } finally {
      await handle2.close();
      rmSync(tmpDir2, { recursive: true, force: true });
    }
  });
});
