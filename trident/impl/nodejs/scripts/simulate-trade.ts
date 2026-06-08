/**
 * simulate-trade.ts
 *
 * Drives the Trident engine through a full trade scenario for UI review.
 * Requires the engine to be running on localhost:3000 (npm run dev).
 *
 * Usage:
 *   npm run simulate
 *   SIMULATE_STEP_MS=500 npm run simulate   # faster steps
 *
 * What it does:
 *   1. Writes a synthetic setup YAML to setups/
 *   2. Waits for the engine to load it (state = "watching")
 *   3. Injects prices step-by-step:
 *      - Idle above Entry 1 (watching, no trigger)
 *      - Entry 1 price  → ENTRY_TRIGGERED (fill 1, 32.5%)
 *      - Entry 2 price  → ENTRY_TRIGGERED (fill 2, 35%)
 *      - Entry 3 price  → ENTRY_TRIGGERED (fill 3, 32.5%)
 *      - Breakeven price → BREAKEVEN_TRIGGERED
 *      - VWAP price      → POSITION_CLOSED
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const BASE_URL = process.env.SIMULATE_BASE_URL ?? 'http://localhost:3000';
const STEP_MS  = Number(process.env.SIMULATE_STEP_MS ?? '2000');

// ── Scenario parameters ─────────────────────────────────────────────────────
// A simple long scenario. Levels are set so Entry 1 triggers at 7500,
// Entry 2 (mid, derived by engine) at ~7487, Entry 3 at 7475.
// VWAP is the profit target. Stop is 40pts below avg entry.

const TODAY = todayStr();
const NOW_TIME = new Date().toTimeString().slice(0, 5);

const SCENARIO = {
  // Setup fields
  date:         TODAY,
  timestamp:    NOW_TIME,
  update_seq:   1,
  futures_last: 7520,
  vwap:         7540,
  // Levels (engine uses max_buy_1 = BUY OUTER, max_buy_2 = BUY INNER)
  max_buy_1:    7475,   // BUY OUTER  → Entry 3
  max_buy_2:    7500,   // BUY INNER  → Entry 1
  max_sell_1:   7590,   // SELL OUTER (not used in long scenario)
  max_sell_2:   7565,   // SELL INNER (not used in long scenario)
  bias:         'neutral' as const,
  // Price steps
  idle_price:   7510,   // above Entry 1 — engine watches, no trigger
  entry1_price: 7500,   // at BUY INNER  → Entry 1 fires
  entry2_price: 7487,   // at mid (derived as (7500+7475)/2 + offset≈2 = ~7489.5, use 7487)
  entry3_price: 7475,   // at BUY OUTER  → Entry 3 fires
  // After all 3 fills: avg ~= (7500*0.325 + 7487*0.35 + 7475*0.325) / 1 ≈ 7487.3
  // Breakeven triggers at avg + 25 = ~7512
  breakeven_price: 7513,
  // VWAP close
  vwap_price:   7540,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: unknown;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

async function getState(): Promise<{ state: string; dailyLocked: boolean } | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/state`);
    if (!res.ok) return null;
    return await res.json() as { state: string; dailyLocked: boolean };
  } catch {
    return null;
  }
}

async function injectPrice(price: number): Promise<void> {
  const result = await post('/simulate/tick', { price });
  if (!result.ok) {
    throw new Error(`/simulate/tick failed (${result.status}): ${JSON.stringify(result.data)}`);
  }
}

async function injectAccountUpdate(unrealizedPnl: number): Promise<void> {
  await post('/simulate/account', { unrealizedPnl, balance: 49877.71, currency: 'EUR' });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function step(label: string): void {
  console.log(`\n▶ ${label}`);
}

// ── Write setup YAML ─────────────────────────────────────────────────────────

function writeSetupYaml(signalsDir: string): string {
  if (!existsSync(signalsDir)) mkdirSync(signalsDir, { recursive: true });
  const hhmm = SCENARIO.timestamp.replace(':', '');
  const filename = `qs_setup_${SCENARIO.date}_${hhmm}.yaml`;
  const path = join(signalsDir, filename);

  const yaml = `schema_version: "1.0"
meta:
  date: "${SCENARIO.date}"
  timestamp: "${SCENARIO.timestamp}"
  update_seq: ${SCENARIO.update_seq}
  futures_last: ${SCENARIO.futures_last}
  execution_instrument: "US500.cash"
volatility:
  dvs: 52.0
  regime: normal
  skew: 140.0
vwap:
  value: ${SCENARIO.vwap}
  updated_at: "${SCENARIO.timestamp}"
  source: manual
levels:
  max_buy_1: ${SCENARIO.max_buy_1}
  max_buy_2: ${SCENARIO.max_buy_2}
  max_sell_1: ${SCENARIO.max_sell_1}
  max_sell_2: ${SCENARIO.max_sell_2}
  additional: []
ranges:
  range_1_up: ${SCENARIO.max_sell_1}
  range_2_up: ${SCENARIO.max_sell_2}
  range_2_down: ${SCENARIO.max_buy_2}
  range_1_down: ${SCENARIO.max_buy_1}
bias:
  direction: ${SCENARIO.bias}
`;

  writeFileSync(path, yaml, 'utf8');
  return filename;
}

// ── Wait for engine state ────────────────────────────────────────────────────

async function waitForState(target: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await getState();
    if (s?.state === target) return;
    await sleep(300);
  }
  throw new Error(`Engine did not reach state "${target}" within ${timeoutMs}ms`);
}

// ── Main scenario ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🎬 Trident UI Simulation');
  console.log(`   Base URL:  ${BASE_URL}`);
  console.log(`   Step delay: ${STEP_MS}ms`);
  console.log(`   Date: ${TODAY}\n`);

  // Check server is reachable
  const initial = await getState();
  if (!initial) {
    console.error('❌ Cannot reach engine at', BASE_URL);
    console.error('   Make sure the engine is running: npm run dev');
    process.exit(1);
  }
  console.log(`✓ Engine connected — current state: ${initial.state}`);

  // Check auto_execute is off by sending a non-numeric payload (won't inject a price)
  const tickCheck = await post('/simulate/tick', { price: 'probe' });
  if (tickCheck.status === 400 && typeof tickCheck.data === 'object' && tickCheck.data !== null &&
      String((tickCheck.data as Record<string,unknown>)['error']).includes('auto_execute')) {
    console.error('❌ auto_execute is enabled in config.yaml — disable it before simulating');
    process.exit(1);
  }

  // Step 0: write the setup YAML
  step('Writing setup YAML to setups/');
  const signalsDir = resolve(process.cwd(), 'setups');
  const filename = writeSetupYaml(signalsDir);
  console.log(`   Written: ${filename}`);

  // Step 1: wait for engine to load the setup
  step('Waiting for engine to load setup (state: watching)…');
  await waitForState('watching');
  console.log('   ✓ Engine is watching');
  await sleep(STEP_MS);

  // Step 2: idle price — engine watches, no trigger
  step(`Injecting idle price ${SCENARIO.idle_price} (above Entry 1 — no trigger expected)`);
  await injectPrice(SCENARIO.idle_price);
  console.log('   ✓ Price injected — engine still watching');
  await sleep(STEP_MS);

  // Step 3: Entry 1
  step(`Injecting Entry 1 price ${SCENARIO.entry1_price} → expect ENTRY_TRIGGERED (fill 1, 32.5%)`);
  await injectPrice(SCENARIO.entry1_price);
  console.log('   ✓ Entry 1 fired');
  await sleep(STEP_MS);

  // Step 4: Entry 2
  step(`Injecting Entry 2 price ${SCENARIO.entry2_price} → expect ENTRY_TRIGGERED (fill 2, 35%)`);
  await injectPrice(SCENARIO.entry2_price);
  console.log('   ✓ Entry 2 fired');
  await sleep(STEP_MS);

  // Step 5: Entry 3
  step(`Injecting Entry 3 price ${SCENARIO.entry3_price} → expect ENTRY_TRIGGERED (fill 3, 32.5%)`);
  await injectPrice(SCENARIO.entry3_price);
  console.log('   ✓ Entry 3 fired — all tranches filled');
  await sleep(STEP_MS);

  // Step 5b: price oscillation — a few ticks to show the chip flashing and P&L moving
  step('Oscillating prices to show P&L changes and price chip flashes…');
  const ticks = [7478, 7472, 7492, 7498, 7490, 7468, 7495, 7502, 7478];
  const pnls  = [-120, -190, +150, +220, +80, -250, +110, +190, -120];
  for (let i = 0; i < ticks.length; i++) {
    await injectPrice(ticks[i]);
    await injectAccountUpdate(pnls[i]);
    await sleep(Math.round(STEP_MS * 0.4));
  }
  console.log('   ✓ Price oscillation complete');
  await sleep(STEP_MS);

  // Step 6: Breakeven
  step(`Injecting breakeven price ${SCENARIO.breakeven_price} → expect BREAKEVEN_TRIGGERED`);
  await injectPrice(SCENARIO.breakeven_price);
  console.log('   ✓ Breakeven triggered — stop moved to avg entry');
  await sleep(STEP_MS);

  // Step 7: VWAP close
  step(`Injecting VWAP price ${SCENARIO.vwap_price} → expect POSITION_CLOSED`);
  await injectPrice(SCENARIO.vwap_price);
  console.log('   ✓ Position closed at VWAP');
  await sleep(300);
  // Reset P&L to zero — position is closed, nothing open at broker.
  await injectAccountUpdate(0);
  await sleep(300);

  // Confirm closed
  const final = await getState();
  console.log(`\n✅ Simulation complete — engine state: ${final?.state ?? 'unknown'}`);
  console.log('   Review the Trident UI at', BASE_URL, 'to validate the layout.');
}

main().catch(err => {
  console.error('\n❌ Simulation error:', err.message);
  process.exit(1);
});
