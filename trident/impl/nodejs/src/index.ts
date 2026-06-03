/**
 * Trident — qs-signal-engine entry point
 *
 * Usage:
 *   npx tsx src/index.ts [--config <path>] [--mock] [--observability <mode>]
 *
 * Flags:
 *   --config <path>           Path to config.yaml (default: ./config.yaml)
 *   --mock                    Use MockPriceFeed with a built-in demo scenario
 *   --observability <mode>    Enable metrics: 'prometheus' or 'otel'
 *                             (also readable from TRIDENT_OBSERVABILITY env var)
 */

import { resolve } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import 'dotenv/config';
import { loadConfig } from './config/loader.js';
import { watchSignalDir, loadSignalFile, scanSignalDirOnce } from './signal/loader.js';
import { MockPriceFeed } from './price-feed/MockPriceFeed.js';
import { CTraderPriceFeed } from './price-feed/CTraderPriceFeed.js';
import { CTraderTrader } from './trader/CTraderTrader.js';
import type { AccountInfo } from './notifier/Notifier.js';
import type { AccountMeta } from './trader/CTraderTrader.js';
import { ConsoleNotifier } from './notifier/ConsoleNotifier.js';
import { LoggerNotifier } from './notifier/LoggerNotifier.js';
import { MultiNotifier } from './notifier/MultiNotifier.js';
import { TridentEngine } from './strategy/TridentEngine.js';
import { startWebServer } from './web/server.js';
import { buildMetricsBackend } from './observability/index.js';
import { MetricsNotifier } from './observability/MetricsNotifier.js';
import { PrometheusBackend } from './observability/PrometheusBackend.js';
import { OtelBackend } from './observability/OtelBackend.js';
import { getLogger } from './logger.js';

const log = getLogger('Trident');
import type { Bootstrap } from './notifier/WebSocketNotifier.js';
import type { Notifier } from './notifier/Notifier.js';

const args = process.argv.slice(2);
const configPath = argValue(args, '--config') ?? './config.yaml';
const useMock = args.includes('--mock');
const signalPath = argValue(args, '--signal');
const webPort = Number(process.env.TRIDENT_WEB_PORT ?? 3000);
// CLI flag takes precedence; env var is the Docker-friendly fallback
const observabilityMode = argValueEquals(args, '--observability') ?? process.env.TRIDENT_OBSERVABILITY;

const config = loadConfig(resolve(configPath));
const metricsBackend = buildMetricsBackend(observabilityMode);

const consoleNotifier = new ConsoleNotifier(/* showPriceTicks = */ false);
// MultiNotifier's children list is mutable so the WebSocket notifier can be
// appended once the web server boots. Engine events go to console immediately
// and to browser clients from the moment the server starts listening.
const notifierChildren: Notifier[] = [consoleNotifier, new LoggerNotifier()];
if (observabilityMode) {
  notifierChildren.push(new MetricsNotifier(metricsBackend));
}
const notifier = new MultiNotifier(notifierChildren);
// Mock runs are ephemeral demos — don't pollute (or restore from) the live snapshot.
const engine = new TridentEngine(config, notifier, {
  snapshotPath: useMock ? null : 'logs/engine-state.json',
});

log.info('Starting');
log.info('Config', { path: resolve(configPath) });

if (observabilityMode === 'prometheus') {
  log.info('Prometheus metrics', { url: `http://localhost:${webPort}/metrics` });
} else if (observabilityMode === 'otel') {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317';
  log.info('OTel exporting', { endpoint });
}

if (useMock) {
  // -------------------------------------------------------------------
  // Demo scenario: long trade from the sample signal file
  // Prices walk through Entry 1, Entry 2, Entry 3, then hit VWAP.
  // -------------------------------------------------------------------
  console.log('\nRunning MOCK scenario — loading sample setup file...\n');

  const sampleSignal = loadSignalFile(
    resolve('../../docs/research/sample-signal-files/qs_setup_2026-04-02_1006.yaml')
  );

  // Patch the date/time so the stale check passes
  sampleSignal.meta.date = new Date().toISOString().slice(0, 10);
  sampleSignal.meta.timestamp = new Date().toTimeString().slice(0, 5);
  sampleSignal.vwap.updated_at = new Date().toTimeString().slice(0, 5);

  // The sample signal has max_buy_1: null and bias: long, so neither side
  // can set up. For the demo, supply a max_buy_1 and use neutral bias
  // so the engine picks the short side (both SELL levels are present).
  sampleSignal.bias = { direction: 'neutral' };

  await engine.loadSignal(sampleSignal, '<mock>');

  // Note: max_buy_1 is null in the sample, so only a short setup is possible
  // (or a long with only Entry 1). The demo will show a short from SELL INNER / SELL OUTER.
  const feed = new MockPriceFeed([
    { price: 6578.67, delayMs: 500 },  // starting price (within range, no trigger)
    { price: 6575.00, delayMs: 800 },
    { price: 6582.50, delayMs: 800 },  // Entry 1 SHORT @ 6582 (SELL INNER)
    { price: 6590.00, delayMs: 800 },  // Entry 2 SHORT
    { price: 6600.00, delayMs: 800 },  // Entry 3 SHORT @ 6616 not yet
    { price: 6616.50, delayMs: 800 },  // Entry 3 SHORT @ 6616 (SELL OUTER)
    { price: 6610.00, delayMs: 800 },
    { price: 6590.00, delayMs: 800 },
    { price: 6570.00, delayMs: 800 },
    { price: 6555.00, delayMs: 800 },  // VWAP hit → close
  ]);

  // This is the critical wiring line — every price tick from the feed drives the
  // engine's entire decision loop: entry triggers, exit conditions, breakeven.
  // Without this, the engine never reacts to market prices.
  feed.subscribe(price => engine.onPriceUpdate(price));
  await feed.connect();

  // Give async events time to flush
  await new Promise(r => setTimeout(r, 500));
  console.log('\nMock scenario complete.');
  process.exit(0);
}

// -------------------------------------------------------------------
// Live mode: start dashboard first (so the UI is responsive regardless
// of broker connectivity), then connect cTrader + watch the signals dir.
// -------------------------------------------------------------------
const signalDir = resolve(config.signal.watch_dir);
log.info('Watching', { dir: signalDir });

const metricsHandler = metricsBackend instanceof PrometheusBackend
  ? metricsBackend.metricsHandler()
  : undefined;

const webServer = await startWebServer({
  port: webPort,
  config,
  signalsDir: signalDir,
  publicDir: resolve('src/web/public'),
  getBootstrap: buildBootstrap,
  metricsHandler,
  getPriceFeed: () => liveFeed,
});
notifierChildren.push(webServer.notifier);
log.info('UI ready', { url: `http://localhost:${webServer.port}` });

// Wire up the real price feed if cTrader credentials are present in the environment
const env = process.env;
let liveFeed: CTraderPriceFeed | null = null;

// Tick-rate tracking: count ticks in the current 60s window, report every 60s
let tickWindowCount = 0;
const tickRateInterval = setInterval(() => {
  metricsBackend.setTickRate(tickWindowCount);
  tickWindowCount = 0;
}, 60_000);
tickRateInterval.unref();

// Seed from env if TRADER_REQ isn't supported by the broker's demo server.
// TRADER_RES overrides this when it arrives (e.g. on live accounts).
let latestAccount: AccountInfo | null =
  env.CTRADER_ACCOUNT_BALANCE
    ? {
        balance:       Number(env.CTRADER_ACCOUNT_BALANCE),
        equity:        Number(env.CTRADER_ACCOUNT_BALANCE),
        unrealizedPnl: 0,
        currency:      env.CTRADER_ACCOUNT_CURRENCY ?? 'USD',
        login:         env.CTRADER_ACCOUNT_ID ? Number(env.CTRADER_ACCOUNT_ID) : 0,
        brokerName:    '',   // filled in by TRADER_RES when available
        isLive:        false,
      }
    : null;

if (!env.CTRADER_CLIENT_ID || !env.CTRADER_CLIENT_SECRET || !env.CTRADER_ACCESS_TOKEN) {
  log.warn('No cTrader credentials — price feed inactive');
  log.info('Run auth:ctrader to configure credentials, or use --mock for a demo');
}

if (env.CTRADER_CLIENT_ID && env.CTRADER_CLIENT_SECRET && env.CTRADER_ACCESS_TOKEN) {
  const symbolName = env.CTRADER_SYMBOL ?? 'US500';
  const feedConfig = {
    clientId:     env.CTRADER_CLIENT_ID,
    clientSecret: env.CTRADER_CLIENT_SECRET,
    accessToken:  env.CTRADER_ACCESS_TOKEN,
    symbolName,
    accountId:    env.CTRADER_ACCOUNT_ID ? Number(env.CTRADER_ACCOUNT_ID) : undefined,
    wsUrl:          env.CTRADER_WS_URL,
    refreshToken:   env.CTRADER_REFRESH_TOKEN,
    tokenExpiresAt: env.CTRADER_TOKEN_EXPIRES_AT ? Number(env.CTRADER_TOKEN_EXPIRES_AT) : undefined,
    symbolId:       env.CTRADER_SYMBOL_ID ? Number(env.CTRADER_SYMBOL_ID) : undefined,
    noHeartbeat:    env.CTRADER_NO_HEARTBEAT === 'true',
    onTokenRefresh: ({ accessToken, refreshToken, expiresAt }: { accessToken: string; refreshToken: string; expiresAt: number }) => {
      writeEnvKey('CTRADER_ACCESS_TOKEN',     accessToken);
      writeEnvKey('CTRADER_REFRESH_TOKEN',    refreshToken);
      writeEnvKey('CTRADER_TOKEN_EXPIRES_AT', String(expiresAt));
      log.info('Tokens refreshed');
    },
  };
  liveFeed = new CTraderPriceFeed(feedConfig);

  liveFeed.subscribe(price => {
    metricsBackend.recordTick(price);
    tickWindowCount++;
    engine.onPriceUpdate(price);
  });

  const connectWithRetry = async () => {
    while (true) {
      try {
        log.info('Connecting to cTrader', { symbol: symbolName });
        await liveFeed!.connect();
        metricsBackend.recordConnectionState(true);
        log.info('cTrader connected');
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        metricsBackend.recordConnectionState(false);
        log.error('cTrader connection failed, retrying', { error: msg, retryMs: 5000 });
        await new Promise(r => setTimeout(r, 5000));
        liveFeed = new CTraderPriceFeed(feedConfig);
        liveFeed.subscribe(price => {
          metricsBackend.recordTick(price);
          tickWindowCount++;
          engine.onPriceUpdate(price);
        });
      }
    }
  };

  await connectWithRetry();

  // CTraderTrader: separate session (C2) for balance + equity polling.
  const traderConfig = {
    clientId:       env.CTRADER_CLIENT_ID,
    clientSecret:   env.CTRADER_CLIENT_SECRET,
    accessToken:    env.CTRADER_ACCESS_TOKEN,
    accountId:      env.CTRADER_ACCOUNT_ID ? Number(env.CTRADER_ACCOUNT_ID) : undefined,
    // CTRADER_TRADER_WS_URL lets the trader use a different server than the
    // price feed. Useful when the broker's demo account needs the live endpoint
    // for TRADER_REQ (e.g. Pepperstone: demo prices on demo.ctraderapi.com,
    // account queries on live.ctraderapi.com).
    wsUrl:          env.CTRADER_TRADER_WS_URL ?? env.CTRADER_WS_URL,
    noHeartbeat:    env.CTRADER_NO_HEARTBEAT === 'true',
    refreshToken:   env.CTRADER_REFRESH_TOKEN,
    tokenExpiresAt: env.CTRADER_TOKEN_EXPIRES_AT ? Number(env.CTRADER_TOKEN_EXPIRES_AT) : undefined,
    onAccountMeta: (meta: AccountMeta) => {
      // Merge broker info into whatever balance data we already have (env seed or
      // a prior TRADER_RES). Fires immediately after handshake, before TRADER_RES.
      if (latestAccount) {
        latestAccount = { ...latestAccount, ...meta };
        notifier.notify({ type: 'ACCOUNT_UPDATE', ...latestAccount }).catch(() => {});
      }
    },
    onAccountUpdate: (info: AccountInfo) => {
      latestAccount = info;
      notifier.notify({ type: 'ACCOUNT_UPDATE', ...info }).catch(() => {});
    },
  };

  const connectTraderWithRetry = async () => {
    while (true) {
      const trader = new CTraderTrader(traderConfig);
      try {
        log.info('Connecting CTraderTrader');
        await trader.connect();
        log.info('CTraderTrader connected');
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('CTraderTrader connection failed, retrying', { error: msg, retryMs: 5000 });
        await trader.disconnect().catch(() => {});
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  };

  // Don't await — runs in the background alongside the price feed.
  connectTraderWithRetry().catch(err => {
    log.error('CTraderTrader retry loop exited', { error: (err as Error).message });
  });
}

// Load a specific signal file immediately if provided
if (signalPath) {
  const signal = loadSignalFile(resolve(signalPath));
  await engine.loadSignal(signal, resolve(signalPath));
}

const stopWatching = watchSignalDir(signalDir, async (signal, filePath) => {
  await engine.loadSignal(signal, filePath);
});

// fs.watch only sees events after it starts. Scan once for today's existing
// files so a signal written during an engine-down window isn't orphaned.
scanSignalDirOnce(signalDir, async (signal, filePath) => {
  await engine.loadSignal(signal, filePath);
});

// Graceful shutdown
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) {
    log.warn('Second signal received — forcing exit', { signal });
    process.exit(130);
  }
  shuttingDown = true;
  log.info('Shutting down', { signal });

  const force = setTimeout(() => {
    log.error('Shutdown timed out — forcing exit');
    process.exit(1);
  }, 5000);
  force.unref();

  clearInterval(tickRateInterval);
  try { stopWatching(); } catch { /* ignore */ }
  try { webServer.flushAiMetrics(); } catch { /* ignore */ }
  try { await webServer.close(); } catch { /* ignore */ }
  try { await liveFeed?.disconnect(); } catch { /* ignore */ }
  if (metricsBackend instanceof OtelBackend) {
    try { await metricsBackend.shutdown(); } catch { /* ignore */ }
  }
  process.exit(0);
}

process.on('SIGINT',  () => { shutdown('SIGINT').catch(() => process.exit(1)); });
process.on('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });

// Helper: --flag=value or --flag value form
function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

// Helper: --flag=value form only (for flags that use = separator)
function argValueEquals(args: string[], flag: string): string | undefined {
  const prefix = `${flag}=`;
  const match = args.find(a => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function buildBootstrap(): Bootstrap {
  const signal = engine.getCurrentSignal();
  const signalPath = engine.getSignalFilePath();
  const position = engine.getPosition();
  return {
    serverTime: new Date().toISOString(),
    state: engine.getState(),
    dailyLocked: engine.isLockedForDay(),
    symbol: process.env.CTRADER_SYMBOL ?? 'US500',
    lastIdleReason: engine.getLastIdleReason(),
    serverTz: getServerTz(),
    currentSignal: signal && signalPath ? {
      filePath: signalPath,
      date: signal.meta.date,
      timestamp: signal.meta.timestamp,
      updateSeq: signal.meta.update_seq,
      dvs: signal.volatility.dvs,
      vwap: signal.vwap.value,
      biasDirection: signal.bias?.direction ?? null,
    } : null,
    position: position ? {
      direction: position.direction,
      avgEntry: position.avgEntry,
      currentStop: position.currentStop,
      vwapTarget: position.vwapTarget,
      fills: position.fills.length,
      fillDetails: position.fills.map(f => ({
        entryNumber: f.entryNumber,
        price: f.price,
        allocationPct: f.allocationPct,
      })),
      breakEvenActive: position.breakEvenActive,
      entrySignalFilePath: position.entrySignalFilePath,
      entrySignal: position.entrySignal,
    } : null,
    stopPoints: config.trident.stop_loss_points,
    account: latestAccount,
  };
}

function getServerTz(): { ianaName: string; offsetStr: string } {
  const now = new Date();
  const ianaName = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offsetMins = -now.getTimezoneOffset(); // positive = east of UTC
  const sign = offsetMins >= 0 ? '+' : '-';
  const h = Math.floor(Math.abs(offsetMins) / 60);
  const m = Math.abs(offsetMins) % 60;
  const offsetStr = m > 0
    ? `UTC${sign}${h}:${String(m).padStart(2, '0')}`
    : `UTC${sign}${h}`;
  return { ianaName, offsetStr };
}

function writeEnvKey(key: string, value: string): void {
  const envFile = '.env';
  const existing = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  const lines = existing.split('\n');
  const idx = lines.findIndex(l => l.startsWith(`${key}=`) || l.startsWith(`${key} =`));
  const newLine = `${key}=${value}`;
  if (idx !== -1) {
    lines[idx] = newLine;
  } else {
    lines.push(newLine);
  }
  writeFileSync(envFile, lines.join('\n'), 'utf8');
}
