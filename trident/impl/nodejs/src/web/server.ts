import express, { type Express, type Request, type Response } from 'express';
import { createServer, type Server } from 'http';
import { WebSocketServer } from 'ws';
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { dump } from 'js-yaml';

import type { QSConfig } from '../config/types.js';
import type { SignalFile } from '../signal/types.js';
import { validateSignal } from '../signal/validator.js';
import { loadSignalFile } from '../signal/loader.js';
import { WebSocketNotifier, type Bootstrap } from '../notifier/WebSocketNotifier.js';
import { buildVisionProvider, SignalExtractor, ExtractionBlockedError, type ImageInput } from '../ai/index.js';
import { getLogger } from '../logger.js';
import { CTraderPriceFeed, type OhlcvBar } from '../price-feed/CTraderPriceFeed.js';

const log = getLogger('WebServer');

const SIGNAL_PATTERN = /^qs_setup_.+\.yaml$/;

export interface StartWebServerOpts {
  port: number;
  config: QSConfig;
  signalsDir: string;
  publicDir: string;
  getBootstrap: () => Bootstrap;
  metricsHandler?: (req: Request, res: Response) => Promise<void>;
  /** Returns the live cTrader feed instance, or null/undefined if not active. */
  getPriceFeed?: () => CTraderPriceFeed | null;
}

export interface WebServerHandle {
  notifier: WebSocketNotifier;
  close: () => Promise<void>;
  port: number;
  /** Flushes AI session metrics to the log. No-op if AI extraction is not configured. */
  flushAiMetrics: () => void;
}

/**
 * Starts the local web UI server: HTTP for the static page and signal
 * submission, WebSocket at /events for the live log stream. The returned
 * WebSocketNotifier should be added to the engine's MultiNotifier chain so
 * every engine event broadcasts to connected browser clients.
 */
export async function startWebServer(opts: StartWebServerOpts): Promise<WebServerHandle> {
  const app = express();
  app.use(express.json({ limit: '128kb' }));

  const screenshotsDir = resolve(opts.signalsDir, '..', 'screenshots');

  if (opts.metricsHandler) {
    app.get('/metrics', opts.metricsHandler);
  }

  app.get('/', (_req: Request, res: Response) => {
    res.sendFile(resolve(opts.publicDir, 'index.html'));
  });
  app.use('/assets', express.static(opts.publicDir));

  app.post(
    '/signals/screenshots',
    express.raw({ type: '*/*', limit: '20mb' }),
    (req, res) => {
      const body = req.body as Buffer | undefined;
      if (!body || !Buffer.isBuffer(body) || body.length === 0) {
        return res.status(400).json({ error: 'Empty body' });
      }
      const original = decodeFilenameHeader(req.header('x-filename'));
      const ext = pickExtension(original, req.header('content-type'));
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeOrig = sanitizeForFilename(original).slice(0, 60);
      const filename = `${stamp}__${safeOrig || 'screenshot'}${ext}`;
      try {
        if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });
        writeFileSync(join(screenshotsDir, filename), body);
      } catch (err) {
        log.error('Failed to save screenshot', { error: (err as Error).message });
        return res.status(500).json({ error: (err as Error).message });
      }
      log.info('Screenshot saved', { filename, bytes: body.length });
      res.json({ filename, bytes: body.length });
    },
  );

  app.get('/signals/latest', (_req, res) => {
    const latest = pickLatestTodaysSignal(opts.signalsDir);
    if (!latest) return res.status(204).end();
    try {
      const signal = loadSignalFile(latest.path);
      res.json({ filename: latest.filename, signal });
    } catch (err) {
      log.error('Failed to read latest setup', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---- AI extraction (screenshots → partial SignalFile + notes/warnings) ----
  // Probe the provider at startup so the operator gets an immediate log line
  // ("AI extraction enabled / disabled") rather than discovering a missing
  // key only when an analyst clicks Import mid-session. Failure to configure
  // is *never* fatal — Trident still loads YAML signals via the manual flow.
  const visionProvider = buildVisionProvider();
  const extractor: SignalExtractor | null = visionProvider
    ? new SignalExtractor(visionProvider)
    : null;
  if (extractor) {
    log.info('AI extraction enabled', {
      provider: visionProvider!.name,
      model: visionProvider!.model,
    });
  }
  function getExtractor(): SignalExtractor | null {
    return extractor;
  }

  app.post('/signals/extract', express.json({ limit: '128kb' }), async (req, res) => {
    const ex = getExtractor();
    if (!ex) {
      return res.status(503).json({
        error: 'AI extraction is not configured on this server (no provider/API key).',
      });
    }
    const filenames = Array.isArray((req.body as { filenames?: unknown }).filenames)
      ? ((req.body as { filenames: unknown[] }).filenames as unknown[]).filter(
          (s): s is string => typeof s === 'string'
        )
      : [];
    if (filenames.length === 0) {
      return res.status(400).json({ error: 'Body must include a non-empty `filenames` array.' });
    }
    if (filenames.length > 3) {
      return res.status(400).json({ error: 'Up to 3 screenshots per extraction.' });
    }
    let images: ImageInput[];
    try {
      images = filenames.map(name => loadScreenshot(screenshotsDir, name));
    } catch (err) {
      log.warn('Failed to read screenshot for extraction', { error: (err as Error).message });
      return res.status(404).json({ error: (err as Error).message });
    }
    try {
      const result = await ex.extract(images, { callerKey: req.ip });
      res.json(result);
    } catch (err) {
      if (err instanceof ExtractionBlockedError) {
        return res.status(400).json({ error: err.message });
      }
      log.error('Extraction failed', { error: (err as Error).message });
      res.status(502).json({ error: `Extraction failed: ${(err as Error).message}` });
    }
  });

  app.get('/api/vwap', async (_req, res) => {
    const feed = opts.getPriceFeed?.() ?? null;
    if (!(feed instanceof CTraderPriceFeed)) {
      return res.status(503).json({ error: 'feed not connected' });
    }
    let bars: OhlcvBar[];
    try {
      bars = await feed.getTodayBars();
    } catch (err) {
      const msg = (err as Error).message ?? 'unknown error';
      return res.status(503).json({ error: msg });
    }
    if (bars.length === 0) {
      return res.status(503).json({ error: 'no bars available' });
    }
    const totalVolume = bars.reduce((s, b) => s + b.volume, 0);
    let vwap: number;
    let volumeWarning = false;
    if (totalVolume > 0) {
      const numerator = bars.reduce((s, b) => s + ((b.high + b.low + b.close) / 3) * b.volume, 0);
      vwap = numerator / totalVolume;
    } else {
      vwap = bars.reduce((s, b) => s + (b.high + b.low + b.close) / 3, 0) / bars.length;
      volumeWarning = true;
    }
    const result: Record<string, unknown> = {
      vwap: Math.round(vwap * 100) / 100,
      barsUsed: bars.length,
      asOf: new Date().toISOString(),
    };
    if (volumeWarning) result.volumeWarning = true;
    log.info('VWAP calculated', { vwap: result.vwap, barsUsed: bars.length, volumeWarning });
    return res.json(result);
  });

  app.post('/signals', (req, res) => {
    const body = req.body as SignalFile;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ valid: false, errors: ['Body must be a SignalFile JSON object'], warnings: [] });
    }
    const result = validateSignal(body, {
      staleThresholdHours: opts.config.signal.stale_threshold_hours,
      vwapStalenessWarnMinutes: opts.config.signal.vwap_staleness_warn_minutes,
    });
    if (!result.valid) {
      return res.status(400).json({ valid: false, errors: result.errors, warnings: result.warnings });
    }

    let written: string;
    try {
      written = writeSignalYaml(opts.signalsDir, body);
    } catch (err) {
      log.error('Failed to write setup file', { error: (err as Error).message });
      return res.status(500).json({ valid: false, errors: [(err as Error).message], warnings: result.warnings });
    }
    log.info('Setup written via web UI', { path: written });
    res.json({ valid: true, filename: written, warnings: result.warnings });
  });

  const server: Server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/events' });
  const notifier = new WebSocketNotifier(wss, opts.getBootstrap, {
    includePriceUpdates: true,
    priceThrottleMs: 500,
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (err: Error) => rejectListen(err);
    server.once('error', onError);
    server.listen(opts.port, () => {
      server.off('error', onError);
      resolveListen();
    });
  });
  const actualPort = (server.address() as { port: number }).port;

  return {
    notifier,
    port: actualPort,
    flushAiMetrics: () => extractor?.flushMetrics(),
    close: () =>
      new Promise<void>(resolveClose => {
        // Forcibly drop any connected browsers — `wss.close()` only stops
        // accepting new connections; without terminating existing clients
        // it'll wait for them to leave on their own (which never happens
        // when a tab stays open) and the whole process hangs on shutdown.
        for (const client of wss.clients) {
          try { client.terminate(); } catch { /* best-effort */ }
        }
        wss.close(() => {
          // Same problem at the HTTP layer: `server.close()` won't return
          // while keep-alive sockets are still open. closeAllConnections
          // (Node 18.2+) hard-cuts them.
          (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
          server.close(() => resolveClose());
        });
      }),
  };
}

/**
 * Atomic write: tmp file + rename. Mirrors src/strategy/persistence.ts so an
 * engine fs.watch can never see a half-written YAML. Uses the setup's own
 * meta.date + meta.timestamp for the filename (HH:MM → HHMM).
 */
function writeSignalYaml(signalsDir: string, signal: SignalFile): string {
  if (!existsSync(signalsDir)) mkdirSync(signalsDir, { recursive: true });
  const hhmm = signal.meta.timestamp.replace(':', '');
  const filename = `qs_setup_${signal.meta.date}_${hhmm}.yaml`;
  const target = resolve(signalsDir, filename);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, dump(signal, { lineWidth: 120 }), 'utf8');
  renameSync(tmp, target);
  return filename;
}

function pickLatestTodaysSignal(
  signalsDir: string
): { filename: string; path: string; mtimeMs: number } | null {
  if (!existsSync(signalsDir)) return null;
  const today = todayStr();
  const datePattern = new RegExp(`^qs_setup_${today}_`);
  let entries: string[];
  try {
    entries = readdirSync(signalsDir);
  } catch {
    return null;
  }
  const candidates = entries
    .filter(f => SIGNAL_PATTERN.test(f) && datePattern.test(f))
    .map(f => {
      const path = resolve(signalsDir, f);
      return { filename: f, path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] ?? null;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function decodeFilenameHeader(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function sanitizeForFilename(name: string): string {
  return name.replace(/\.[^./\\]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

/**
 * Read a previously-uploaded screenshot off disk and wrap it as an ImageInput
 * for the AI provider. Throws if the file isn't where /signals/screenshots
 * said it would be (mismatched filename, deleted, etc).
 */
function loadScreenshot(screenshotsDir: string, filename: string): ImageInput {
  // Defensive: don't allow path traversal — only basenames live in screenshotsDir.
  const safe = filename.replace(/[/\\]/g, '');
  const path = resolve(screenshotsDir, safe);
  if (!path.startsWith(resolve(screenshotsDir) + '/') && path !== resolve(screenshotsDir, safe)) {
    throw new Error(`Refusing to read outside screenshots dir: ${filename}`);
  }
  if (!existsSync(path)) throw new Error(`Screenshot not found: ${filename}`);
  const bytes = readFileSync(path);
  return {
    bytes,
    mimeType: pickMimeType(safe),
    filename: safe,
  };
}

function pickMimeType(filename: string): string {
  const ext = (/\.([a-zA-Z0-9]+)$/.exec(filename)?.[1] ?? '').toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
  };
  return map[ext] ?? 'application/octet-stream';
}

function pickExtension(originalName: string, contentType: string | undefined): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(originalName);
  if (m) return `.${m[1].toLowerCase()}`;
  if (!contentType) return '.bin';
  const ct = contentType.split(';')[0].trim().toLowerCase();
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/heic': '.heic',
  };
  return map[ct] ?? '.bin';
}
