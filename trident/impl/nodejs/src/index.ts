/**
 * Trident — qs-signal-engine entry point
 *
 * Usage:
 *   npx tsx src/index.ts [--config <path>] [--mock]
 *
 * Flags:
 *   --config <path>   Path to config.yaml (default: ./config.yaml)
 *   --mock            Use MockPriceFeed with a built-in demo scenario
 */

import { resolve } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import 'dotenv/config';
import { loadConfig } from './config/loader.js';
import { watchSignalDir, loadSignalFile } from './signal/loader.js';
import { MockPriceFeed } from './price-feed/MockPriceFeed.js';
import { CTraderPriceFeed } from './price-feed/CTraderPriceFeed.js';
import { ConsoleNotifier } from './notifier/ConsoleNotifier.js';
import { TridentEngine } from './strategy/TridentEngine.js';

const args = process.argv.slice(2); // process.argv[0] — the path to the node executable ,process.argv[1] — the path to the script being run
const configPath = argValue(args, '--config') ?? './config.yaml';
const useMock = args.includes('--mock');
const signalPath = argValue(args, '--signal'); // load a specific signal file directly

const config = loadConfig(resolve(configPath));
const notifier = new ConsoleNotifier(/* showPriceTicks = */ false);
const engine = new TridentEngine(config, notifier);

console.log('Trident qs-signal-engine starting...');
console.log(`Config: ${resolve(configPath)}`);

if (useMock) {
  // -------------------------------------------------------------------
  // Demo scenario: long trade from the sample signal file
  // Prices walk through Entry 1, Entry 2, Entry 3, then hit VWAP.
  // -------------------------------------------------------------------
  console.log('\nRunning MOCK scenario — loading sample signal file...\n');

  const sampleSignal = loadSignalFile(
    resolve('../../docs/research/sample-signal-files/qs_signal_2026-04-02_1006.yaml')
  );

  // Patch the date/time so the stale check passes
  sampleSignal.meta.date = new Date().toISOString().slice(0, 10);
  sampleSignal.meta.timestamp = new Date().toTimeString().slice(0, 5);
  sampleSignal.vwap.updated_at = new Date().toTimeString().slice(0, 5);
  sampleSignal.invalidation.expiry = '23:59';

  // The sample signal has max_buy_1: null and bias: long, so neither side
  // can set up. For the demo, supply a max_buy_1 and use neutral bias
  // so the engine picks the short side (both SELL levels are present).
  sampleSignal.bias = { direction: 'neutral', confidence: 'medium' };

  await engine.loadSignal(sampleSignal, '<mock>');

  // Note: max_buy_1 is null in the sample, so only a short setup is possible
  // (or a long with only Entry 1). The demo will show a short from MAX SELL 2 / MAX SELL 1.
  const feed = new MockPriceFeed([
    { price: 6578.67, delayMs: 500 },  // starting price (within range, no trigger)
    { price: 6575.00, delayMs: 800 },
    { price: 6582.50, delayMs: 800 },  // Entry 1 SHORT @ 6582 (MAX SELL 2)
    { price: 6590.00, delayMs: 800 },  // Entry 2 SHORT
    { price: 6600.00, delayMs: 800 },  // Entry 3 SHORT @ 6616 not yet
    { price: 6616.50, delayMs: 800 },  // Entry 3 SHORT @ 6616 (MAX SELL 1)
    { price: 6610.00, delayMs: 800 },
    { price: 6590.00, delayMs: 800 },
    { price: 6570.00, delayMs: 800 },
    { price: 6555.00, delayMs: 800 },  // VWAP hit → close
  ]);

  // This is the critical wiring line — every price tick from the feed drives the
  // engine's entire decision loop: entry triggers, exit conditions, breakeven,
  // invalidation checks. Without this, the engine never reacts to market prices.
  feed.subscribe(price => engine.onPriceUpdate(price));
  await feed.connect();

  // Give async events time to flush
  await new Promise(r => setTimeout(r, 500));
  console.log('\nMock scenario complete.');
  process.exit(0);
}

// -------------------------------------------------------------------
// Live mode: connect cTrader price feed + watch the signals directory
// -------------------------------------------------------------------
const signalDir = resolve(config.signal.watch_dir);
console.log(`Watching for signals in: ${signalDir}\n`);

// Wire up the real price feed if cTrader credentials are present in the environment
const env = process.env;
let liveFeed: CTraderPriceFeed | null = null;

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
      console.log('Refreshed tokens written to .env');
    },
  };
  liveFeed = new CTraderPriceFeed(feedConfig);

  liveFeed.subscribe(price => engine.onPriceUpdate(price));

  // Connect with automatic reconnect. The demo server closes idle connections
  // after ~60s; the live server may disconnect on network blips. We reconnect
  // indefinitely with a short delay so the engine stays live.
  const connectWithRetry = async () => {
    while (true) {
      try {
        console.log(`Connecting to cTrader (symbol: ${symbolName})...`);
        await liveFeed!.connect();
        console.log('cTrader price feed connected.\n');
        return; // success — hand off to the running process
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // "closed before ready" means the server dropped us before the handshake
        // completed (idle timeout, bad symbolId, etc.) — retry after a short pause.
        console.error(`cTrader connection failed: ${msg}`);
        console.log('Retrying in 5 seconds...');
        await new Promise(r => setTimeout(r, 5000));
        // Re-create the feed so internal state (ws, counters) is fresh
        liveFeed = new CTraderPriceFeed(feedConfig);
        liveFeed.subscribe(price => engine.onPriceUpdate(price));
      }
    }
  };

  await connectWithRetry();
} else {
  console.log('No cTrader credentials found in environment — price feed inactive.');
  console.log('Run `npm run auth:ctrader` to set up credentials, or use --mock for a demo.\n');
}

// Load a specific signal file immediately if provided
if (signalPath) {
  const signal = loadSignalFile(resolve(signalPath));
  await engine.loadSignal(signal, resolve(signalPath));
}

const stopWatching = watchSignalDir(signalDir, async (signal, filePath) => {
  await engine.loadSignal(signal, filePath);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  stopWatching();
  liveFeed?.disconnect().finally(() => process.exit(0)) ?? process.exit(0);
});

// Helper
function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

// Updates a single key in .env without touching other lines.
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
