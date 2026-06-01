import type { SignalFile } from './types.js';
import { getLogger } from '../logger.js';

const log = getLogger('Validator');

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const VALID_REGIMES = ['compressed', 'normal', 'elevated', 'extreme'];
const VALID_DIRECTIONS = ['long', 'short', 'neutral'];
const VALID_INSTRUMENTS = ['ES', 'US500.cash', 'SPX'];

export function validateSignal(
  signal: SignalFile,
  opts: { staleThresholdHours: number; vwapStalenessWarnMinutes: number }
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  log.debug('Starting validation', {
    date: signal.meta?.date,
    update_seq: signal.meta?.update_seq,
    dvs: signal.volatility?.dvs,
  });

  // Rule 1: schema version
  if (signal.schema_version !== '1.0') {
    errors.push(`Unsupported schema_version: ${signal.schema_version}`);
  }

  // Rule 2: required top-level sections
  if (!signal.meta)         errors.push('Missing required section: meta');
  if (!signal.volatility)   errors.push('Missing required section: volatility');
  if (!signal.vwap)         errors.push('Missing required section: vwap');
  if (!signal.ranges)       errors.push('Missing required section: ranges');
  if (!signal.levels)       errors.push('Missing required section: levels');

  if (errors.length > 0) return { valid: false, errors, warnings };

  const ref = signal.meta.futures_last;

  // TODO: remove Rule 3 and the entire ranges section once confirmed with FB that ranges.*
  // are redundant (auto-derived from levels.* since the single-IV-chart workflow, 2026-05-12).
  // Rule 3: range ordering — only checked when all four values are present (nulls mean only
  // one level side was supplied; level ordering rules 4/5 already catch that case).
  const { range_1_down, range_2_down, range_2_up, range_1_up } = signal.ranges;
  if (
    range_1_down !== null && range_2_down !== null &&
    range_2_up !== null && range_1_up !== null &&
    !(range_1_down < range_2_down && range_2_down < range_2_up && range_2_up < range_1_up)
  ) {
    errors.push(
      `Range ordering invalid: expected range_1_down < range_2_down < range_2_up < range_1_up, ` +
        `got ${range_1_down} < ${range_2_down} < ${range_2_up} < ${range_1_up}`
    );
  }

  // Rule 4: buy level ordering (BUY OUTER < BUY INNER, i.e. buy_1 < buy_2)
  const { max_buy_1, max_buy_2 } = signal.levels;
  if (max_buy_1 !== null && max_buy_2 !== null && !(max_buy_1 < max_buy_2)) {
    errors.push(
      `Buy level ordering invalid: BUY OUTER/max_buy_1 (${max_buy_1}) must be < BUY INNER/max_buy_2 (${max_buy_2})`
    );
  }

  // Rule 5: sell level ordering (SELL INNER < SELL OUTER, i.e. sell_2 < sell_1)
  const { max_sell_1, max_sell_2 } = signal.levels;
  if (max_sell_1 !== null && max_sell_2 !== null && !(max_sell_2 < max_sell_1)) {
    errors.push(
      `Sell level ordering invalid: SELL INNER/max_sell_2 (${max_sell_2}) must be < SELL OUTER/max_sell_1 (${max_sell_1})`
    );
  }

  // Rule 5b: at least one tradeable level pair must be present, otherwise the
  // engine has nothing to act on and will immediately emit NO SETUP.
  const hasBuyPair  = max_buy_1  !== null && max_buy_2  !== null;
  const hasSellPair = max_sell_1 !== null && max_sell_2 !== null;
  if (!hasBuyPair && !hasSellPair) {
    errors.push(
      'Required levels are missing — provide BUY OUTER+INNER or SELL OUTER+INNER ' +
        '(or both pairs); otherwise the engine has no entries to trade.'
    );
  }

  // Rule 6: price sanity (all non-null prices within 20% of futures_last)
  const pricesToCheck: [string, number | null][] = [
    ['ranges.range_1_up', range_1_up],
    ['ranges.range_2_up', range_2_up],
    ['ranges.range_2_down', range_2_down],
    ['ranges.range_1_down', range_1_down],
    ['levels.max_sell_1', max_sell_1],
    ['levels.max_sell_2', max_sell_2],
    ['levels.max_buy_1', max_buy_1],
    ['levels.max_buy_2', max_buy_2],
    ['vwap.value',       signal.vwap.value],
  ];
  for (const [label, price] of pricesToCheck) {
    if (price !== null && (price <= 0 || Math.abs(price - ref) / ref > 0.2)) {
      errors.push(`${label} (${price}) is not positive or is more than 20% away from futures_last (${ref})`);
    }
  }

  // Rule 7: basis sanity (skipped when basis is null — field is optional)
  const { basis } = signal.meta;
  if (basis !== null && (basis < -100 || basis > 200)) {
    errors.push(`basis (${basis}) out of expected range -100..200`);
  }

  // Rule 8: basis math (skipped when either field is null — both are optional)
  if (signal.meta.cash_last !== null && basis !== null) {
    const impliedBasis = signal.meta.futures_last - signal.meta.cash_last;
    if (Math.abs(impliedBasis - basis) > 5) {
      errors.push(
        `Basis math mismatch: futures_last - cash_last = ${impliedBasis.toFixed(2)}, ` +
          `basis field = ${basis} (tolerance ±5)`
      );
    }
  }

  // Rule 9: DVS range
  if (signal.volatility.dvs < 0 || signal.volatility.dvs > 200) {
    errors.push(`dvs (${signal.volatility.dvs}) out of range 0..200`);
  }

  // Rule 10: VWAP present
  if (!signal.vwap.value || signal.vwap.value <= 0) {
    errors.push('vwap.value must be present and > 0');
  }

  // Rule 11: enum values
  if (!VALID_REGIMES.includes(signal.volatility.regime)) {
    errors.push(`volatility.regime "${signal.volatility.regime}" is not valid. Expected: ${VALID_REGIMES.join(', ')}`);
  }
  if (!VALID_INSTRUMENTS.includes(signal.meta.execution_instrument)) {
    errors.push(`meta.execution_instrument "${signal.meta.execution_instrument}" is not valid`);
  }
  if (signal.bias) {
    if (!VALID_DIRECTIONS.includes(signal.bias.direction)) {
      errors.push(`bias.direction "${signal.bias.direction}" is not valid`);
    }
  }

  // Rule 12: stale check
  const signalTime = parseTimeOnDate(signal.meta.date, signal.meta.timestamp);
  const nowMs = Date.now();
  const signalAgeHours = (nowMs - signalTime.getTime()) / (1000 * 60 * 60);
  if (signalAgeHours > opts.staleThresholdHours) {
    errors.push(
      `Setup is stale: created ${signalAgeHours.toFixed(1)}h ago (threshold: ${opts.staleThresholdHours}h)`
    );
  }

  // Rule 13: VWAP freshness (warning only)
  const vwapTime = parseTimeOnDate(signal.meta.date, signal.vwap.updated_at);
  const vwapAgeMinutes = (nowMs - vwapTime.getTime()) / (1000 * 60);
  if (vwapAgeMinutes > opts.vwapStalenessWarnMinutes) {
    warnings.push(
      `VWAP was last updated ${vwapAgeMinutes.toFixed(0)} minutes ago (warn threshold: ${opts.vwapStalenessWarnMinutes}min)`
    );
  }

  const valid = errors.length === 0;
  if (valid) {
    log.debug('Validation passed', { warnings: warnings.length });
  } else {
    log.warn('Validation failed', { errorCount: errors.length, errors });
  }
  if (warnings.length > 0) {
    log.warn('Validation warnings', { warnings });
  }

  return { valid, errors, warnings };
}

function parseTimeOnDate(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}
