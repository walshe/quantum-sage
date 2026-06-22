/**
 * acceptance-tests/runner.ts
 *
 * Full-stack acceptance test runner.
 *
 * Usage:
 *   npm run acceptance
 *   ACCEPTANCE_SCENARIO=01-long-full npm run acceptance   # single scenario
 *
 * Requires:
 *   - npx playwright install chromium  (one-time setup)
 *   - auto_execute: true is written into the temp config automatically
 *   - CTRADER_ACCOUNT_BALANCE env var (or defaults to 50000)
 *   - MOCK_BROKER=true is passed automatically to the engine subprocess
 */

import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { chromium, type Browser, type Page } from 'playwright';
import { scenarios } from './scenarios/index.js';
import { waitForEngineReady, waitForState, resetEngine, writeSetupYaml, post, sleep, getState } from './helpers.js';
import type { Scenario, ScenarioStep, EngineState } from './types.js';

// ── Config ───────────────────────────────────────────────────────────────────

const PORT         = Number(process.env.TRIDENT_WEB_PORT ?? 3000);
const BASE_URL     = `http://localhost:${PORT}`;
const ONLY_SCENARIO = process.env.ACCEPTANCE_SCENARIO;
const SEED_BALANCE = Number(process.env.CTRADER_ACCOUNT_BALANCE ?? 50_000);

const RUN_ID    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const RESULTS_DIR  = resolve('acceptance-results', RUN_ID);
const SETUPS_DIR   = resolve(`/tmp/qs-acceptance-${process.pid}`);
const CONFIG_PATH  = resolve(`/tmp/qs-acceptance-config-${process.pid}.yaml`);

// ── Result types ──────────────────────────────────────────────────────────────

interface ScenarioResult {
  scenario: string;
  description: string;
  passed: boolean;
  expectedState: EngineState;
  actualState: string | null;
  durationMs: number;
  error?: string;
}

// ── Write temp acceptance config ──────────────────────────────────────────────

function writeAcceptanceConfig(): void {
  mkdirSync(SETUPS_DIR, { recursive: true });
  const yaml = `capital:
  daily_risk_pct: 0.5

trident:
  entry_1_allocation_pct: 32.5
  entry_2_allocation_pct: 35.0
  entry_3_allocation_pct: 32.5
  midpoint_offset_buy: 2
  midpoint_offset_sell: -2
  stop_loss_points: 40
  breakeven_trigger_points: 25
  hard_profit_exit_points: 33
  # Short time exit so 04-long-time-exit completes in ~32s
  time_exit_minutes: 0.5
  dvs_gate: 75

size_adaptation:
  after_one_loss_day: 0.5
  after_two_loss_days: 0.25

signal:
  watch_dir: "${SETUPS_DIR}"
  stale_threshold_hours: 24
  vwap_staleness_warn_minutes: 9999

execution:
  auto_execute: true
  point_value_eur: 1.0
`;
  writeFileSync(CONFIG_PATH, yaml, 'utf8');
}

// ── Engine subprocess ──────────────────────────────────────────────────────────

function startEngine(): ChildProcess {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MOCK_BROKER:             'true',
    NODE_ENV:                'test',
    TRIDENT_WEB_PORT:        String(PORT),
    CTRADER_ACCOUNT_BALANCE: String(SEED_BALANCE),
    // Use a temp snapshot so no stale state (blocked, in_trade, etc.) is restored
    TRIDENT_SNAPSHOT_PATH:   `/tmp/qs-acceptance-snapshot-${process.pid}.json`,
    // Unset cTrader credentials — mock broker path needs none, and real
    // credentials would trigger the real price feed connection loop
    CTRADER_CLIENT_ID:       undefined,
    CTRADER_CLIENT_SECRET:   undefined,
    CTRADER_ACCESS_TOKEN:    undefined,
  };

  const child = spawn('npx', ['tsx', 'src/index.ts', '--config', CONFIG_PATH], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (d: Buffer) => process.stdout.write(`[engine] ${d}`));
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[engine] ${d}`));

  return child;
}

// ── Playwright UI tracking ─────────────────────────────────────────────────────

async function openBrowser(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await sleep(3_000);

  return { browser, page };
}

async function screenshot(page: Page, path: string): Promise<void> {
  mkdirSync(resolve(path, '..'), { recursive: true });
  await page.screenshot({ path, fullPage: true });
}

// Wait for #status-pane to reflect the expected engine state before screenshotting.
// #status-pane[data-state] is set by renderStatusPanel() in app.js after every
// WebSocket event — more reliable than tracking raw WS event types.
async function waitForUiState(page: Page, expectedState: EngineState, timeoutMs = 8_000): Promise<void> {
  await page.waitForFunction(
    (s) => document.querySelector('#status-pane')?.getAttribute('data-state') === s,
    expectedState,
    { timeout: timeoutMs },
  ).catch(() => { /* best-effort — screenshot anyway */ });
  await sleep(200);
}

// ── Scenario execution ────────────────────────────────────────────────────────

async function runScenario(
  scenario: Scenario,
  page: Page,
  scenarioDir: string,
): Promise<ScenarioResult> {
  const start = Date.now();
  console.log(`\n  ▶ ${scenario.name}: ${scenario.description}`);

  try {
    // Reset engine to idle before each scenario.
    // reset() clears dailyLocked internally but emits no WS event, so we reload
    // the page afterwards to flush stale UI state (locked pill, log entries, etc).
    const currentState = await getState();
    const needsReset = currentState?.state !== 'idle' || currentState?.dailyLocked;
    if (needsReset) {
      await post('/engine/reset', {});
      await waitForState('idle', 5_000);
    }

    // Write the initial setup YAML
    writeSetupYaml(scenario.setup, SETUPS_DIR, scenario.name);
    console.log(`    ✓ Setup YAML written`);

    // Determine what initial state to wait for
    const dvs = scenario.setup.dvs;
    const dvsGate = 75;
    const initialExpectedState: EngineState = dvs > dvsGate ? 'blocked' : 'watching';
    await waitForState(initialExpectedState, 10_000);

    // Reload the page so the browser bootstraps fresh with the current engine state.
    // Without this, the UI retains stale WS state from the previous scenario.
    if (needsReset) {
      await page.reload({ waitUntil: 'networkidle' });
      await sleep(2_000);
    }

    await waitForUiState(page, initialExpectedState);

    console.log(`    ✓ Engine reached: ${initialExpectedState}`);

    // Before screenshot
    await screenshot(page, join(scenarioDir, 'before.png'));
    console.log(`    ✓ before.png`);

    // Execute steps
    let stepIdx = 0;
    for (const step of scenario.steps) {
      stepIdx++;
      console.log(`    → step ${stepIdx}: ${step.label}`);

      if (step.type === 'submit-setup') {
        // Write a new setup YAML (re-submission)
        writeSetupYaml(step.setup, SETUPS_DIR, `${scenario.name}-update${stepIdx}`);
        if (step.expectState) {
          await waitForState(step.expectState, 10_000);
          await waitForUiState(page, step.expectState);
        }
        if (step.screenshot) {
          await screenshot(page, join(scenarioDir, 'steps', `${stepIdx.toString().padStart(2,'0')}-${sanitize(step.label)}.png`));
        }
        continue;
      }

      // PriceStep
      const priceStep = step as Extract<ScenarioStep, { type?: 'price' }>;
      if (priceStep.delayMs) {
        console.log(`      (waiting ${priceStep.delayMs}ms…)`);
        await sleep(priceStep.delayMs);
      }

      await post('/simulate/tick', { price: priceStep.price });

      if (priceStep.accountUpdate) {
        await post('/simulate/account', priceStep.accountUpdate);
      }

      if (priceStep.expectState) {
        await waitForState(priceStep.expectState, 10_000);
        await waitForUiState(page, priceStep.expectState);
        console.log(`      ✓ state: ${priceStep.expectState}`);
      }

      if (priceStep.screenshot) {
        await screenshot(page, join(scenarioDir, 'steps', `${stepIdx.toString().padStart(2,'0')}-${sanitize(step.label)}.png`));
        console.log(`      ✓ step screenshot saved`);
      }
    }

    // Wait for final state
    await waitForState(scenario.expectedFinalState, 12_000);

    // After screenshot — wait for the UI to reflect the final state before capturing
    await waitForUiState(page, scenario.expectedFinalState);
    await screenshot(page, join(scenarioDir, 'after.png'));
    console.log(`    ✓ after.png`);

    const actualState = (await getState())?.state ?? null;
    const passed = actualState === scenario.expectedFinalState;
    console.log(`    ${passed ? '✅' : '❌'} Final state: ${actualState} (expected: ${scenario.expectedFinalState})`);

    const result: ScenarioResult = {
      scenario:      scenario.name,
      description:   scenario.description,
      passed,
      expectedState: scenario.expectedFinalState,
      actualState,
      durationMs:    Date.now() - start,
    };
    writeFileSync(join(scenarioDir, 'result.json'), JSON.stringify(result, null, 2));
    return result;

  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`    ❌ Error: ${error}`);
    const actualState = (await getState())?.state ?? null;
    try { await screenshot(page, join(scenarioDir, 'after.png')); } catch { /* ignore */ }
    const result: ScenarioResult = {
      scenario:      scenario.name,
      description:   scenario.description,
      passed:        false,
      expectedState: scenario.expectedFinalState,
      actualState,
      durationMs:    Date.now() - start,
      error,
    };
    writeFileSync(join(scenarioDir, 'result.json'), JSON.stringify(result, null, 2));
    return result;
  }
}

function sanitize(label: string): string {
  return label.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
}

// ── HTML report ──────────────────────────────────────────────────────────────

function imgTag(filePath: string, alt: string): string {
  try {
    const src = `data:image/png;base64,${readFileSync(filePath).toString('base64')}`;
    const safeAlt = alt.replace(/'/g, "\\'");
    return `<img src="${src}" alt="${alt}" class="qs-thumb" onclick="qsZoom(this.src,'${safeAlt}')" style="width:100%;border-radius:6px;border:1px solid #e5e7eb;display:block">`;
  } catch { return ''; }
}

function stateLabel(s: string | null): string {
  switch (s) {
    case 'watching': return 'Watching for entry';
    case 'in_trade': return 'In trade';
    case 'closed':   return 'Trade closed';
    case 'blocked':  return 'Blocked — DVS gate';
    case 'idle':     return 'Idle';
    default:         return s ?? 'unknown';
  }
}

function generateReport(
  results: ScenarioResult[],
  scenarioMap: Map<string, Scenario>,
  resultsDir: string,
  runId: string,
): void {
  const passed  = results.filter(r => r.passed).length;
  const allPass = passed === results.length;

  const cards = results.map(r => {
    const sc        = scenarioMap.get(r.scenario);
    const dir       = join(resultsDir, r.scenario);
    const stepsDir  = join(dir, 'steps');
    const passBg    = r.passed ? '#22c55e' : '#ef4444';
    const cardBorder = r.passed ? '#bbf7d0' : '#fecaca';

    // Setup chips
    const setup = sc?.setup;
    const chips: string[] = [];
    if (setup) {
      const DVS_GATE = 75;
      const dvsClear = (setup.dvs ?? 0) <= DVS_GATE;
      const dvsColor = dvsClear ? '#16a34a' : '#dc2626';
      const dvsLabel = dvsClear ? `gate clear (limit: ${DVS_GATE})` : `gate blocked (limit: ${DVS_GATE})`;
      chips.push(`DVS: ${setup.dvs} <span style="color:${dvsColor}">${dvsClear ? '✓ ' : ''}${dvsLabel}</span>`);
      chips.push(`Bias: ${setup.bias ?? 'neutral'}`);
      if (setup.max_buy_2  != null) chips.push(`Buy outer: ${setup.max_buy_2}`);
      if (setup.max_buy_1  != null) chips.push(`Buy inner: ${setup.max_buy_1}`);
      if (setup.max_sell_1 != null) chips.push(`Sell inner: ${setup.max_sell_1}`);
      if (setup.max_sell_2 != null) chips.push(`Sell outer: ${setup.max_sell_2}`);
      chips.push(`Futures last: ${setup.futures_last}`);
      chips.push(`VWAP: ${setup.vwap}`);
    }
    const setupHtml = chips.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">
           ${chips.map(c => `<span style="background:#f3f4f6;border-radius:20px;padding:3px 10px;font-size:12px;color:#374151">${c}</span>`).join('')}
         </div>`
      : '';

    // Steps list
    const stepsHtml = sc?.steps.length
      ? `<ol style="margin:0 0 14px;padding-left:18px;font-size:13px;color:#374151;line-height:2">
           ${sc.steps.map(step => {
             if (step.type === 'submit-setup') {
               return `<li><strong>Re-submit setup</strong> — ${step.label}${step.expectState ? ` → <em>${stateLabel(step.expectState)}</em>` : ''}</li>`;
             }
             const ps = step as Extract<typeof step, { type?: 'price' }>;
             const delayNote = ps.delayMs ? ` <span style="color:#9ca3af">(wait ${(ps.delayMs / 1000).toFixed(0)}s)</span>` : '';
             return `<li>${ps.label}${ps.price != null ? ` — <code style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-family:monospace">${ps.price}</code>` : ''}${delayNote}${ps.expectState ? ` → <em style="color:#6b7280">${stateLabel(ps.expectState)}</em>` : ''}</li>`;
           }).join('')}
         </ol>`
      : '';

    // Screenshots: before → step shots (in order) → after
    const shotCells: string[] = [];
    const addShot = (filePath: string, label: string) => {
      const tag = imgTag(filePath, label);
      if (tag) shotCells.push(`<div style="flex:1;min-width:260px;max-width:420px">
        <p style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;margin:0 0 5px;text-align:center">${label}</p>
        ${tag}
      </div>`);
    };

    addShot(join(dir, 'before.png'), 'Before');
    if (existsSync(stepsDir)) {
      for (const f of readdirSync(stepsDir).sort()) {
        if (!f.endsWith('.png')) continue;
        const label = f.replace(/^\d+-/, '').replace(/-/g, ' ').replace(/\.png$/, '');
        addShot(join(stepsDir, f), label);
      }
    }
    addShot(join(dir, 'after.png'), 'After');

    const shotsHtml = shotCells.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:16px">${shotCells.join('')}</div>`
      : '';

    return `<div style="background:#fff;border:1px solid ${cardBorder};border-radius:10px;padding:20px 22px;margin-bottom:24px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <span style="background:${passBg};color:#fff;font-weight:700;padding:3px 12px;border-radius:20px;font-size:12px;letter-spacing:.04em">${r.passed ? 'PASS' : 'FAIL'}</span>
        <h2 style="margin:0;font-size:17px;color:#111;text-transform:capitalize">${r.scenario.replace(/^\d+-/, '').replace(/-/g, ' ')}</h2>
        <span style="margin-left:auto;font-size:12px;color:#9ca3af">${(r.durationMs / 1000).toFixed(1)}s</span>
      </div>
      <p style="margin:0 0 12px;color:#374151;font-size:14px;line-height:1.5">${r.description}</p>
      ${setupHtml}
      ${stepsHtml}
      <div style="font-size:13px;color:#374151;border-top:1px solid #f3f4f6;padding-top:10px">
        Expected outcome: <strong>${stateLabel(r.expectedState)}</strong>
        &ensp;→&ensp;
        Actual: <strong style="color:${r.passed ? '#16a34a' : '#dc2626'}">${stateLabel(r.actualState)}</strong>
        ${r.error ? `<br><span style="color:#dc2626;font-size:12px;margin-top:4px;display:block">⚠ ${r.error}</span>` : ''}
      </div>
      ${shotsHtml}
    </div>`;
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Trident Acceptance — ${runId}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;margin:0;padding:24px;color:#111}
    code{font-family:'SF Mono','Fira Code',monospace}
    h1,h2,p{margin:0}
    .qs-thumb{cursor:zoom-in;transition:opacity .15s}
    .qs-thumb:hover{opacity:.85}
    #qs-lb{display:none;position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9999;align-items:center;justify-content:center;cursor:zoom-out}
    #qs-lb.open{display:flex}
    #qs-lb img{max-width:95vw;max-height:95vh;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,.6)}
    #qs-lb-label{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);color:#fff;font-size:13px;opacity:.7;pointer-events:none}
  </style>
</head>
<body>
<div id="qs-lb" onclick="this.classList.remove('open')">
  <img id="qs-lb-img" src="" alt="">
  <span id="qs-lb-label"></span>
</div>
<script>
  document.addEventListener('keydown', e => { if(e.key==='Escape') document.getElementById('qs-lb').classList.remove('open'); });
  function qsZoom(src, label) {
    document.getElementById('qs-lb-img').src = src;
    document.getElementById('qs-lb-label').textContent = label;
    document.getElementById('qs-lb').classList.add('open');
  }
</script>
<div style="max-width:1100px;margin:0 auto">
  <div style="margin-bottom:28px">
    <h1 style="font-size:24px;margin-bottom:4px">Trident Acceptance Report</h1>
    <p style="color:#6b7280;font-size:13px">Run: ${runId}</p>
    <div style="margin-top:14px;display:inline-block;background:${allPass ? '#22c55e' : '#ef4444'};color:#fff;font-weight:700;padding:8px 22px;border-radius:24px;font-size:15px">
      ${passed}/${results.length} scenarios passed
    </div>
  </div>
  ${cards.join('\n')}
</div>
</body>
</html>`;

  const reportPath = join(resultsDir, 'report.html');
  writeFileSync(reportPath, html, 'utf8');
  console.log(`  Report:    ${reportPath}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n🎬 Trident Acceptance Test Suite');
  console.log(`   Run ID:    ${RUN_ID}`);
  console.log(`   Results:   ${RESULTS_DIR}`);
  console.log(`   Engine:    ${BASE_URL}`);

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeAcceptanceConfig();

  const scenariosToRun = ONLY_SCENARIO
    ? scenarios.filter(s => s.name.includes(ONLY_SCENARIO))
    : scenarios;

  if (scenariosToRun.length === 0) {
    console.error(`\n❌ No scenarios matching "${ONLY_SCENARIO}"`);
    process.exit(1);
  }

  console.log(`   Scenarios: ${scenariosToRun.map(s => s.name).join(', ')}\n`);

  const engine = startEngine();
  let browser: Browser | null = null;
  const results: ScenarioResult[] = [];
  const suiteStart = Date.now();

  try {
    // Wait for engine to be ready
    process.stdout.write('  Waiting for engine…');
    await waitForEngineReady(15_000);
    console.log(' ready\n');

    // Open Playwright browser
    const { browser: b, page } = await openBrowser();
    browser = b;

    for (const scenario of scenariosToRun) {
      const scenarioDir = join(RESULTS_DIR, scenario.name);
      mkdirSync(scenarioDir, { recursive: true });
      const result = await runScenario(scenario, page, scenarioDir);
      results.push(result);
    }

  } finally {
    await browser?.close();
    engine.kill('SIGTERM');
    // Clean up temp files
    try { rmSync(CONFIG_PATH, { force: true }); } catch { /* ignore */ }
    try { rmSync(SETUPS_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // Summary
  const passed  = results.filter(r => r.passed).length;
  const failed  = results.filter(r => !r.passed).length;
  const totalMs = Date.now() - suiteStart;

  const summary = { totalScenarios: results.length, passed, failed, durationMs: totalMs, results };
  writeFileSync(join(RESULTS_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  const scenarioMap = new Map(scenariosToRun.map(s => [s.name, s]));
  generateReport(results, scenarioMap, RESULTS_DIR, RUN_ID);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ACCEPTANCE TEST RESULTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    const ms   = `${r.durationMs}ms`.padStart(7);
    console.log(`  ${icon} ${r.scenario.padEnd(30)} ${ms}`);
    if (!r.passed) console.log(`     Expected: ${r.expectedState}  Actual: ${r.actualState}  ${r.error ?? ''}`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ${passed}/${results.length} passed  (${totalMs}ms)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n❌ Runner error:', (err as Error).message);
  process.exit(1);
});
