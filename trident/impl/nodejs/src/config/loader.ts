import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import type { QSConfig } from './types.js';
import { getLogger } from '../logger.js';

const log = getLogger('Config');

export function loadConfig(path: string): QSConfig {
  log.info('Loading config', { path });

  const raw = readFileSync(path, 'utf8');
  const parsed = load(raw) as QSConfig;

  const allocs = [
    parsed.trident.entry_1_allocation_pct,
    parsed.trident.entry_2_allocation_pct,
    parsed.trident.entry_3_allocation_pct,
  ];
  const sum = allocs.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.01) {
    log.error('Entry allocations do not sum to 100', { sum, allocs });
    throw new Error(`Config: entry allocations must sum to 100, got ${sum}`);
  }

  log.info('Config loaded', {
    dvs_gate: parsed.trident.dvs_gate,
    stop_loss_points: parsed.trident.stop_loss_points,
    time_exit_minutes: parsed.trident.time_exit_minutes,
    daily_risk_pct: parsed.capital.daily_risk_pct,
  });

  return parsed;
}
