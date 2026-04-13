import { readFileSync, watch } from 'fs';
import { resolve } from 'path';
import { load } from 'js-yaml';
import type { SignalFile } from './types.js';
import { getLogger } from '../logger.js';

const log = getLogger('SignalLoader');

export type SignalCallback = (signal: SignalFile, filePath: string) => void;

const SIGNAL_PATTERN = /^qs_signal_.+\.yaml$/;

/**
 * Watches a directory for new or updated signal YAML files.
 * Files must match the pattern qs_signal_*.yaml.
 * The callback fires with the parsed signal whenever a matching file
 * is created or changed.
 */
export function watchSignalDir(dir: string, onSignal: SignalCallback): () => void {
  const absDir = resolve(dir);
  log.info('Watching signal directory', { dir: absDir });

  const watcher = watch(absDir, { persistent: true }, (eventType, filename) => {
    if (!filename || !SIGNAL_PATTERN.test(filename)) return;
    if (eventType !== 'rename' && eventType !== 'change') return;

    log.debug('File change detected', { filename, eventType });

    const filePath = resolve(absDir, filename);
    try {
      const signal = loadSignalFile(filePath);
      log.info('Signal file parsed', {
        filename,
        date: signal.meta.date,
        update_seq: signal.meta.update_seq,
        dvs: signal.volatility.dvs,
      });
      onSignal(signal, filePath);
    } catch (err) {
      log.error('Failed to parse signal file', {
        filename,
        error: (err as Error).message,
      });
    }
  });

  return () => {
    log.info('Stopped watching signal directory', { dir: absDir });
    watcher.close();
  };
}

export function loadSignalFile(filePath: string): SignalFile {
  log.debug('Reading signal file from disk', { filePath });
  const raw = readFileSync(filePath, 'utf8');
  return load(raw) as SignalFile;
}
