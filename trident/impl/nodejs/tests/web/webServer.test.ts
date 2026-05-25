import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { dump, load } from 'js-yaml';
import { startWebServer, type WebServerHandle } from '../../src/web/server.js';
import type { QSConfig } from '../../src/config/types.js';
import type { SignalFile } from '../../src/signal/types.js';
import type { Bootstrap } from '../../src/notifier/WebSocketNotifier.js';

const TODAY = new Date().toISOString().slice(0, 10);
const NOW_TIME = new Date().toTimeString().slice(0, 5);

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
  serverTime: '2026-04-21T10:00:00.000Z',
  state: 'idle', dailyLocked: false, symbol: 'US500', currentSignal: null, position: null,
};

function makeSignal(): SignalFile {
  return {
    schema_version: '1.0',
    meta: { date: TODAY, timestamp: NOW_TIME, update_seq: 1, contract: 'ESM6',
            futures_last: 6578.67, cash_last: 6535.67, basis: 43.00, execution_instrument: 'ES' },
    volatility: { dvs: 61.34, dvs_prior: 49.33, skew: 145.45, regime: 'normal' },
    vwap: { value: 6555.00, updated_at: NOW_TIME, source: 'manual' },
    ranges: { range_1_up: 6680.25, range_2_up: 6647.25, range_2_down: 6542.75, range_1_down: 6509.75 },
    levels: {
      level_time: NOW_TIME,
      max_sell_1: 6616.00, max_sell_2: 6582.00, max_buy_1: null, max_buy_2: 6467.00,
      supporto: 6500.00, resistenza: null, additional: [],
    },
    levels_recal: {
      level_time: null, max_sell_1: null, max_sell_2: null, max_buy_1: null,
      max_buy_2: null, supporto: null, resistenza: null, additional: [],
    },
    bias: { direction: 'neutral', confidence: 'medium' },
    invalidation: { void_above: 6700.00, void_below: 6430.00, expiry: '23:59' },
  };
}

let tmp: string;
let signalsDir: string;
let publicDir: string;
let handle: WebServerHandle;
let baseUrl: string;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'trident-web-'));
  signalsDir = join(tmp, 'signals');
  publicDir = join(tmp, 'public');
  handle = await startWebServer({
    port: 0, // ephemeral
    config,
    signalsDir,
    publicDir,
    getBootstrap: () => bootstrap,
  });
  baseUrl = `http://localhost:${handle.port}`;
});

afterEach(async () => {
  await handle.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('web server — POST /signals', () => {
  it('accepts a valid signal, writes YAML atomically, returns filename', async () => {
    const signal = makeSignal();
    const res = await fetch(`${baseUrl}/signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signal),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean; filename: string; warnings: string[] };
    expect(body.valid).toBe(true);
    const hhmm = NOW_TIME.replace(':', '');
    expect(body.filename).toBe(`qs_setup_${TODAY}_${hhmm}.yaml`);

    const written = join(signalsDir, body.filename);
    expect(existsSync(written)).toBe(true);
    const parsed = load(readFileSync(written, 'utf8')) as SignalFile;
    expect(parsed.meta.date).toBe(TODAY);
    expect(parsed.volatility.dvs).toBe(61.34);
  });

  it('rejects an invalid signal with 400 and errors array', async () => {
    const bad = makeSignal();
    bad.schema_version = '99.0'; // triggers rule 1
    const res = await fetch(`${baseUrl}/signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bad),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { valid: boolean; errors: string[] };
    expect(body.valid).toBe(false);
    expect(body.errors.some(e => e.includes('schema_version'))).toBe(true);
  });

  it('rejects a non-object body with 400', async () => {
    const res = await fetch(`${baseUrl}/signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify('not a signal'),
    });
    expect(res.status).toBe(400);
  });
});

describe('web server — GET /signals/latest', () => {
  it('returns 204 when no signals exist', async () => {
    const res = await fetch(`${baseUrl}/signals/latest`);
    expect(res.status).toBe(204);
  });

  it('returns the most recent signal for today', async () => {
    // write two files: one for yesterday, one for today
    const signal = makeSignal();
    const hhmm = NOW_TIME.replace(':', '');
    const todayFile = join(signalsDir, `qs_setup_${TODAY}_${hhmm}.yaml`);
    const yesterdayDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const yesterdayFile = join(signalsDir, `qs_setup_${yesterdayDate}_0900.yaml`);

    // need the dir first
    const { mkdirSync } = await import('fs');
    mkdirSync(signalsDir, { recursive: true });
    writeFileSync(todayFile, dump(signal));
    writeFileSync(yesterdayFile, dump(signal));

    const res = await fetch(`${baseUrl}/signals/latest`);
    expect(res.status).toBe(200);
    const body = await res.json() as { filename: string; signal: SignalFile };
    expect(body.filename).toBe(`qs_setup_${TODAY}_${hhmm}.yaml`);
    expect(body.signal.meta.date).toBe(TODAY);
  });
});
