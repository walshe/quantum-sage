import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { SetupFields, EngineState } from './types.js';

const BASE_URL = process.env.ACCEPTANCE_BASE_URL ?? 'http://localhost:3000';

export async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: unknown;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

export async function getState(): Promise<{ state: string; dailyLocked: boolean } | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/state`);
    if (!res.ok) return null;
    return await res.json() as { state: string; dailyLocked: boolean };
  } catch {
    return null;
  }
}

export async function waitForState(target: EngineState, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await getState();
    if (s?.state === target) return;
    await sleep(200);
  }
  const actual = (await getState())?.state ?? 'unreachable';
  throw new Error(`Engine did not reach state "${target}" within ${timeoutMs}ms (actual: ${actual})`);
}

export async function waitForEngineReady(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await getState();
    if (s !== null) return;
    await sleep(300);
  }
  throw new Error('Engine did not respond within 15s — is it running?');
}

export async function resetEngine(): Promise<void> {
  await post('/engine/reset', {});
  // Engine may be in 'closed' or other terminal state — wait for 'idle'
  await waitForState('idle', 5_000);
}

export function writeSetupYaml(setup: SetupFields, signalsDir: string, tag: string): string {
  if (!existsSync(signalsDir)) mkdirSync(signalsDir, { recursive: true });

  const today = todayStr();
  const now = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
  // Include tag in filename so concurrent scenarios and re-submits never collide
  const filename = `qs_setup_${today}_${now}_${tag}.yaml`;
  const path = join(signalsDir, filename);

  const yaml = `schema_version: "1.0"
meta:
  date: "${today}"
  timestamp: "${new Date().toTimeString().slice(0, 5)}"
  update_seq: 1
  futures_last: ${setup.futures_last}
  execution_instrument: "US500.cash"
volatility:
  dvs: ${setup.dvs}
  regime: ${setup.regime ?? 'normal'}
  skew: 140.0
vwap:
  value: ${setup.vwap}
  updated_at: "${new Date().toTimeString().slice(0, 5)}"
  source: manual
levels:
  max_buy_1: ${setup.max_buy_1 ?? 'null'}
  max_buy_2: ${setup.max_buy_2 ?? 'null'}
  max_sell_1: ${setup.max_sell_1 ?? 'null'}
  max_sell_2: ${setup.max_sell_2 ?? 'null'}
  additional: []
ranges:
  range_1_up: ${setup.max_sell_1 ?? 'null'}
  range_2_up: ${setup.max_sell_2 ?? 'null'}
  range_2_down: ${setup.max_buy_2 ?? 'null'}
  range_1_down: ${setup.max_buy_1 ?? 'null'}
bias:
  direction: ${setup.bias}
`;

  writeFileSync(path, yaml, 'utf8');
  return filename;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
