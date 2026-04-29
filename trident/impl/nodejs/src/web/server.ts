import express, { type Express, type Request, type Response } from 'express';
import { createServer, type Server } from 'http';
import { WebSocketServer } from 'ws';
import { readdirSync, renameSync, statSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { dump } from 'js-yaml';

import type { QSConfig } from '../config/types.js';
import type { SignalFile } from '../signal/types.js';
import { validateSignal } from '../signal/validator.js';
import { loadSignalFile } from '../signal/loader.js';
import { WebSocketNotifier, type Bootstrap } from '../notifier/WebSocketNotifier.js';
import { getLogger } from '../logger.js';

const log = getLogger('WebServer');

const SIGNAL_PATTERN = /^qs_signal_.+\.yaml$/;

export interface StartWebServerOpts {
  port: number;
  config: QSConfig;
  signalsDir: string;
  publicDir: string;
  getBootstrap: () => Bootstrap;
}

export interface WebServerHandle {
  notifier: WebSocketNotifier;
  close: () => Promise<void>;
  port: number;
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
      log.error('Failed to read latest signal', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
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
      log.error('Failed to write signal file', { error: (err as Error).message });
      return res.status(500).json({ valid: false, errors: [(err as Error).message], warnings: result.warnings });
    }
    log.info('Signal written via web UI', { path: written });
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
    close: () =>
      new Promise<void>(resolveClose => {
        wss.close(() => {
          server.close(() => resolveClose());
        });
      }),
  };
}

/**
 * Atomic write: tmp file + rename. Mirrors src/strategy/persistence.ts so an
 * engine fs.watch can never see a half-written YAML. Uses the signal's own
 * meta.date + meta.timestamp for the filename (HH:MM → HHMM).
 */
function writeSignalYaml(signalsDir: string, signal: SignalFile): string {
  if (!existsSync(signalsDir)) mkdirSync(signalsDir, { recursive: true });
  const hhmm = signal.meta.timestamp.replace(':', '');
  const filename = `qs_signal_${signal.meta.date}_${hhmm}.yaml`;
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
  const datePattern = new RegExp(`^qs_signal_${today}_`);
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
