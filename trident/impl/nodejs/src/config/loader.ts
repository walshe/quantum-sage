import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import type { QSConfig } from './types.js';
import { getLogger } from '../logger.js';

const log = getLogger('Config');

function isPositive(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

function validateConfig(c: unknown): string[] {
  const errors: string[] = [];
  const e = (msg: string) => errors.push(msg);

  if (typeof c !== 'object' || c === null) {
    return ['config.yaml is empty or not a valid YAML object'];
  }

  const cfg = c as Record<string, unknown>;

  // ── capital ───────────────────────────────────────────────────────────────
  const cap = cfg['capital'] as Record<string, unknown> | undefined;
  if (!cap) {
    e('capital section is missing');
  } else {
    if (!isPositive(cap['daily_risk_pct']) || (cap['daily_risk_pct'] as number) >= 100)
      e('capital.daily_risk_pct must be a positive number less than 100');
  }

  // ── trident ───────────────────────────────────────────────────────────────
  const t = cfg['trident'] as Record<string, unknown> | undefined;
  if (!t) {
    e('trident section is missing');
  } else {
    const a1 = t['entry_1_allocation_pct'];
    const a2 = t['entry_2_allocation_pct'];
    const a3 = t['entry_3_allocation_pct'];

    if (!isPositive(a1)) e('trident.entry_1_allocation_pct must be a positive number');
    if (!isPositive(a2)) e('trident.entry_2_allocation_pct must be a positive number');
    if (!isPositive(a3)) e('trident.entry_3_allocation_pct must be a positive number');

    if (isPositive(a1) && isPositive(a2) && isPositive(a3)) {
      const sum = (a1 as number) + (a2 as number) + (a3 as number);
      if (Math.abs(sum - 100) > 0.01)
        e(`trident entry allocations must sum to 100, got ${sum}`);
    }

    if (!isNumber(t['midpoint_offset_buy']))
      e('trident.midpoint_offset_buy must be a number');
    if (!isNumber(t['midpoint_offset_sell']))
      e('trident.midpoint_offset_sell must be a number');
    if (!isPositive(t['stop_loss_points']))
      e('trident.stop_loss_points must be a positive number');
    if (!isPositive(t['breakeven_trigger_points']))
      e('trident.breakeven_trigger_points must be a positive number');
    if (!isPositive(t['hard_profit_exit_points']))
      e('trident.hard_profit_exit_points must be a positive number');
    if (!isPositive(t['time_exit_minutes']))
      e('trident.time_exit_minutes must be a positive number');
    if (!isPositive(t['dvs_gate']) || (t['dvs_gate'] as number) > 200)
      e('trident.dvs_gate must be a positive number ≤ 200');

    // breakeven should trigger before hard profit exit
    if (isPositive(t['breakeven_trigger_points']) && isPositive(t['hard_profit_exit_points'])) {
      if ((t['breakeven_trigger_points'] as number) >= (t['hard_profit_exit_points'] as number))
        e('trident.breakeven_trigger_points must be less than hard_profit_exit_points');
    }
  }

  // ── size_adaptation ───────────────────────────────────────────────────────
  const sa = cfg['size_adaptation'] as Record<string, unknown> | undefined;
  if (!sa) {
    e('size_adaptation section is missing');
  } else {
    const one = sa['after_one_loss_day'];
    const two = sa['after_two_loss_days'];
    if (!isPositive(one) || (one as number) > 1)
      e('size_adaptation.after_one_loss_day must be between 0 and 1');
    if (!isPositive(two) || (two as number) > 1)
      e('size_adaptation.after_two_loss_days must be between 0 and 1');
    if (isPositive(one) && isPositive(two) && (two as number) >= (one as number))
      e('size_adaptation.after_two_loss_days must be less than after_one_loss_day');
  }

  // ── signal ────────────────────────────────────────────────────────────────
  const sig = cfg['signal'] as Record<string, unknown> | undefined;
  if (!sig) {
    e('signal section is missing');
  } else {
    if (typeof sig['watch_dir'] !== 'string' || !(sig['watch_dir'] as string).trim())
      e('signal.watch_dir must be a non-empty string');
    if (!isPositive(sig['stale_threshold_hours']))
      e('signal.stale_threshold_hours must be a positive number');
    if (!isPositive(sig['vwap_staleness_warn_minutes']))
      e('signal.vwap_staleness_warn_minutes must be a positive number');
  }

  // ── execution (optional section) ─────────────────────────────────────────
  const exec = cfg['execution'] as Record<string, unknown> | undefined;
  if (exec) {
    if (exec['auto_execute'] === true && !isPositive(exec['point_value_eur']))
      e('execution.point_value_eur must be a positive number when auto_execute is true');
  }

  return errors;
}

export function loadConfig(path: string): QSConfig {
  log.info('Loading config', { path });

  const raw = readFileSync(path, 'utf8');
  const parsed = load(raw);

  const errors = validateConfig(parsed);
  if (errors.length > 0) {
    for (const err of errors) log.error(`Config error: ${err}`);
    throw new Error(`config.yaml has ${errors.length} error(s):\n  ${errors.join('\n  ')}`);
  }

  const cfg = parsed as QSConfig;

  log.info('Config loaded', {
    dvs_gate: cfg.trident.dvs_gate,
    stop_loss_points: cfg.trident.stop_loss_points,
    time_exit_minutes: cfg.trident.time_exit_minutes,
    daily_risk_pct: cfg.capital.daily_risk_pct,
  });

  return cfg;
}
