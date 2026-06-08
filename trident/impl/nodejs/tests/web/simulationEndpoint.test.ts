import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { startWebServer, type WebServerHandle } from '../../src/web/server.js';
import type { QSConfig } from '../../src/config/types.js';
import type { Bootstrap } from '../../src/notifier/WebSocketNotifier.js';

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

const configWithAutoExecute: QSConfig = {
  ...config,
  execution: { auto_execute: true, point_value_eur: 1 },
};

const bootstrap: Bootstrap = {
  serverTime: '2026-06-06T10:00:00.000Z',
  state: 'idle', dailyLocked: false, symbol: 'US500', lastIdleReason: null,
  serverTz: { ianaName: 'Europe/Dublin', offsetStr: 'UTC+1' },
  currentSignal: null, position: null, stopPoints: 40, funMode: false,
};

let server: WebServerHandle;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(tmpdir() + '/trident-sim-test-');
  const origEnv = process.env.NODE_ENV;
  // Reset to non-production for most tests
  process.env.NODE_ENV = 'test';
  server = await startWebServer({
    port: 0,
    config,
    signalsDir: tmpDir,
    publicDir: tmpDir,
    getBootstrap: () => bootstrap,
    getEngineState: () => ({ state: 'idle', dailyLocked: false }),
    onSimulatedTick: () => {},
  });
});

afterEach(async () => {
  await server.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('/simulate/tick', () => {
  it('returns 404 in production', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await fetch(`http://localhost:${server.port}/simulate/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: 7500 }),
      });
      expect(res.status).toBe(404);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('returns 400 when auto_execute is enabled', async () => {
    const autoExecServer = await startWebServer({
      port: 0,
      config: configWithAutoExecute,
      signalsDir: tmpDir,
      publicDir: tmpDir,
      getBootstrap: () => bootstrap,
      onSimulatedTick: () => {},
    });
    try {
      const res = await fetch(`http://localhost:${autoExecServer.port}/simulate/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: 7500 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('auto_execute');
    } finally {
      await autoExecServer.close();
    }
  });

  it('calls onSimulatedTick and returns 200 in dev mode', async () => {
    const ticks: number[] = [];
    const tickServer = await startWebServer({
      port: 0,
      config,
      signalsDir: tmpDir,
      publicDir: tmpDir,
      getBootstrap: () => bootstrap,
      onSimulatedTick: (p) => ticks.push(p),
    });
    try {
      const res = await fetch(`http://localhost:${tickServer.port}/simulate/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: 7500 }),
      });
      expect(res.status).toBe(200);
      expect(ticks).toEqual([7500]);
    } finally {
      await tickServer.close();
    }
  });

  it('returns 400 for invalid price', async () => {
    const res = await fetch(`http://localhost:${server.port}/simulate/tick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: 'not-a-number' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('/api/state', () => {
  it('returns engine state', async () => {
    const res = await fetch(`http://localhost:${server.port}/api/state`);
    expect(res.status).toBe(200);
    const body = await res.json() as { state: string; dailyLocked: boolean };
    expect(body.state).toBe('idle');
    expect(body.dailyLocked).toBe(false);
  });
});
