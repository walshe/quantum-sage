import { readFileSync, readdirSync, statSync, watch } from 'fs';
import { resolve } from 'path';
import { load } from 'js-yaml';
import type { SignalFile } from './types.js';
import { getLogger } from '../logger.js';

const log = getLogger('SignalLoader');

export type SignalCallback = (signal: SignalFile, filePath: string) => void;

const SIGNAL_PATTERN = /^qs_setup_.+\.yaml$/;
const SIGNAL_FILENAME_DATE = /^qs_setup_(\d{4}-\d{2}-\d{2})_/;

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Watches a directory for new or updated signal YAML files.
 * Files must match the pattern qs_signal_*.yaml.
 * The callback fires with the parsed signal whenever a matching file
 * is created or changed.
 */
export function watchSignalDir(dir: string, onSignal: SignalCallback): () => void {
  const absDir = resolve(dir);
  log.info('Watching setup directory', { dir: absDir });

  const watcher = watch(absDir, { persistent: true }, (eventType, filename) => {
    if (!filename || !SIGNAL_PATTERN.test(filename)) return;
    if (eventType !== 'rename' && eventType !== 'change') return;

    log.debug('File change detected', { filename, eventType });

    const filePath = resolve(absDir, filename);
    try {
      const signal = loadSignalFile(filePath);
      log.info('Setup file parsed', {
        filename,
        date: signal.meta.date,
        update_seq: signal.meta.update_seq,
        dvs: signal.volatility.dvs,
      });
      onSignal(signal, filePath);
    } catch (err) {
      log.error('Failed to parse setup file', {
        filename,
        error: (err as Error).message,
      });
    }
  });

  return () => {
    log.info('Stopped watching setup directory', { dir: absDir });
    watcher.close();
  };
}

export function loadSignalFile(filePath: string): SignalFile {
  log.debug('Reading setup file from disk', { filePath });
  const raw = readFileSync(filePath, 'utf8');
  return load(raw) as SignalFile;
}

/**
 * Scans the signal directory once at startup for today's signal files and
 * invokes the callback with the most recent one (by file mtime).
 *
 * fs.watch only fires on events *after* it starts — existing files are
 * invisible to it. This fills that gap: a signal written while the engine
 * was down (crash, restart, signal submitted via the web UI just before
 * boot) is picked up on next start rather than being orphaned.
 *
 * Only today's files are considered. Yesterday's signal is deliberately
 * ignored because the daily lock + staleness rules would reject it anyway.
 */
export function scanSignalDirOnce(dir: string, onSignal: SignalCallback): void {
  const absDir = resolve(dir);
  const today = todayStr();
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch (err) {
    log.warn('Setup directory not readable on startup scan', {
      dir: absDir, error: (err as Error).message,
    });
    return;
  }

  const candidates: { filename: string; mtimeMs: number }[] = [];
  for (const filename of entries) {
    if (!SIGNAL_PATTERN.test(filename)) continue;
    const dateMatch = SIGNAL_FILENAME_DATE.exec(filename);
    if (!dateMatch || dateMatch[1] !== today) continue;
    try {
      const s = statSync(resolve(absDir, filename));
      candidates.push({ filename, mtimeMs: s.mtimeMs });
    } catch {
      // ignore — file may have disappeared between readdir and stat
    }
  }

  if (candidates.length === 0) {
    log.info('Startup scan found no setup files for today', { dir: absDir, today });
    return;
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const chosen = candidates[0];
  const filePath = resolve(absDir, chosen.filename);
  log.info('Startup scan loading most recent setup file', {
    filename: chosen.filename, candidates: candidates.length,
  });
  try {
    const signal = loadSignalFile(filePath);
    onSignal(signal, filePath);
  } catch (err) {
    log.error('Failed to parse setup file during startup scan', {
      filename: chosen.filename, error: (err as Error).message,
    });
  }
}
