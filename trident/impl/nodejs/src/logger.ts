/**
 * Central logger for Trident.
 *
 * Two audiences, two outputs:
 *   Console  — human-readable, colored, for operator/dev visibility
 *   File     — JSON lines in logs/trident.log, for audit trail
 *
 * Log levels (set via LOG_LEVEL env var, default: info):
 *   error  — something broke; trading may be affected
 *   warn   — degraded state; DVS gate, stale data, validation issues
 *   info   — normal operational milestones (signal loaded, entry filled, trade closed)
 *   debug  — detailed decision trace; price ticks, trigger checks, state transitions
 *
 * Usage:
 *   import { getLogger } from '../logger.js';
 *   const log = getLogger('TridentEngine');
 *   log.info('Entry filled', { entry: 1, price: 6467 });
 *
 * For clean trader output, set LOG_LEVEL=warn to suppress info/debug from console
 * while the ConsoleNotifier still shows trade events.
 */

import winston from 'winston';
import { mkdirSync } from 'fs';

// Ensure logs directory exists
mkdirSync('logs', { recursive: true });

const LEVEL = process.env.LOG_LEVEL ?? 'info';

// ── Console format ─────────────────────────────────────────────────────────
// HH:MM:SS LEVEL  [Module]  message  {meta}
// Visually distinct from ConsoleNotifier output (which uses brackets differently)

const LEVEL_COLORS: Record<string, string> = {
  error: '\x1b[31m',   // red
  warn:  '\x1b[33m',   // yellow
  info:  '\x1b[36m',   // cyan
  debug: '\x1b[90m',   // grey
};
const RESET = '\x1b[0m';
const DIM   = '\x1b[2m';

const consoleFormat = winston.format.printf(({ level, message, module, timestamp, ...meta }) => {
  const color  = LEVEL_COLORS[level] ?? '';
  const mod    = module ? `${DIM}[${module}]${RESET}` : '';
  const lvl    = `${color}${level.toUpperCase().padEnd(5)}${RESET}`;
  const metaKeys = Object.keys(meta).filter(k => k !== 'splat');
  const metaStr  = metaKeys.length > 0
    ? `  ${DIM}${JSON.stringify(Object.fromEntries(metaKeys.map(k => [k, meta[k]])))}${RESET}`
    : '';
  return `${DIM}${timestamp}${RESET} ${lvl} ${mod} ${message}${metaStr}`;
});

// ── Base logger ────────────────────────────────────────────────────────────

const base = winston.createLogger({
  level: LEVEL,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        consoleFormat
      ),
    }),
    new winston.transports.File({
      filename: 'logs/trident.log',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
  ],
});

// ── Per-module child loggers ───────────────────────────────────────────────

export function getLogger(module: string): winston.Logger {
  return base.child({ module });
}
