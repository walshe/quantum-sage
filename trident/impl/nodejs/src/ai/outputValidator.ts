import { getLogger } from '../logger.js';
import type { ExtractionResult } from './types.js';

const log = getLogger('OutputValidator');

export class OutputValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Output validation failed: ${errors.join('; ')}`);
    this.name = 'OutputValidationError';
  }
}

const BIAS_DIRECTIONS = new Set(['long', 'short', 'neutral']);
const VOLATILITY_REGIMES = new Set(['compressed', 'normal', 'elevated', 'extreme']);

/**
 * Validates a parsed ExtractionResult at runtime against known shape and range
 * constraints. Throws OutputValidationError (after logging) if any check fails.
 * Returns the result typed as ExtractionResult on success.
 */
export function validateExtractionResult(result: unknown): ExtractionResult {
  const errors: string[] = [];

  if (result === null || typeof result !== 'object') {
    throw new OutputValidationError(['result is not an object']);
  }

  const r = result as Record<string, unknown>;

  // ── Top-level fields ──────────────────────────────────────────────────────

  if (!Array.isArray(r['notes']) || !(r['notes'] as unknown[]).every(n => typeof n === 'string')) {
    errors.push('notes must be an array of strings');
  }
  if (!Array.isArray(r['warnings']) || !(r['warnings'] as unknown[]).every(w => typeof w === 'string')) {
    errors.push('warnings must be an array of strings');
  }
  if (typeof r['provider'] !== 'string') {
    errors.push('provider must be a string');
  }
  if (typeof r['model'] !== 'string') {
    errors.push('model must be a string');
  }

  // ── Signal object ─────────────────────────────────────────────────────────

  if (r['signal'] === null || typeof r['signal'] !== 'object') {
    errors.push('signal must be an object');
    throwIfErrors(errors, result);
  }

  const sig = r['signal'] as Record<string, unknown>;

  if (sig['schema_version'] !== undefined && sig['schema_version'] !== '1.0') {
    errors.push(`schema_version must be "1.0", got "${sig['schema_version']}"`);
  }

  // ── volatility ────────────────────────────────────────────────────────────

  if (sig['volatility'] != null) {
    const vol = sig['volatility'] as Record<string, unknown>;
    checkNumericOrNull(vol, 'dvs',       errors, 'signal.volatility.dvs');
    checkNumericOrNull(vol, 'dvs_prior', errors, 'signal.volatility.dvs_prior');
    checkNumericOrNull(vol, 'skew',      errors, 'signal.volatility.skew');

    const dvs = vol['dvs'];
    if (dvs !== null && dvs !== undefined && typeof dvs === 'number') {
      if (dvs < 0 || dvs > 200) {
        errors.push(`signal.volatility.dvs out of range (0–200): ${dvs}`);
      }
    }

    if (vol['regime'] !== null && vol['regime'] !== undefined) {
      if (typeof vol['regime'] !== 'string' || !VOLATILITY_REGIMES.has(vol['regime'] as string)) {
        errors.push(`signal.volatility.regime invalid: "${vol['regime']}" — expected one of ${[...VOLATILITY_REGIMES].join(', ')}`);
      }
    }
  }

  // ── vwap ──────────────────────────────────────────────────────────────────

  if (sig['vwap'] != null) {
    const vwap = sig['vwap'] as Record<string, unknown>;
    checkNumericOrNull(vwap, 'value', errors, 'signal.vwap.value');
  }

  // ── ranges ────────────────────────────────────────────────────────────────

  if (sig['ranges'] != null) {
    const ranges = sig['ranges'] as Record<string, unknown>;
    for (const field of ['range_1_up', 'range_2_up', 'range_2_down', 'range_1_down']) {
      checkNumericOrNull(ranges, field, errors, `signal.ranges.${field}`);
    }
  }

  // ── levels / levels_recal ─────────────────────────────────────────────────

  for (const block of ['levels', 'levels_recal']) {
    if (sig[block] != null) {
      const levels = sig[block] as Record<string, unknown>;
      for (const field of ['max_sell_1', 'max_sell_2', 'max_buy_1', 'max_buy_2']) {
        checkNumericOrNull(levels, field, errors, `signal.${block}.${field}`);
        const val = levels[field];
        if (val !== null && val !== undefined && typeof val === 'number' && val <= 0) {
          errors.push(`signal.${block}.${field} must be positive, got ${val}`);
        }
      }
    }
  }

  // ── bias ──────────────────────────────────────────────────────────────────

  if (sig['bias'] != null) {
    const bias = sig['bias'] as Record<string, unknown>;
    if (bias['direction'] !== null && bias['direction'] !== undefined) {
      if (typeof bias['direction'] !== 'string' || !BIAS_DIRECTIONS.has(bias['direction'] as string)) {
        errors.push(`signal.bias.direction invalid: "${bias['direction']}" — expected long, short, or neutral`);
      }
    }
  }

  // ── meta numeric fields ───────────────────────────────────────────────────

  if (sig['meta'] != null) {
    const meta = sig['meta'] as Record<string, unknown>;
    for (const field of ['futures_last', 'cash_last', 'basis', 'update_seq']) {
      checkNumericOrNull(meta, field, errors, `signal.meta.${field}`);
    }
  }

  throwIfErrors(errors, result);
  return result as ExtractionResult;
}

function checkNumericOrNull(obj: Record<string, unknown>, field: string, errors: string[], label: string): void {
  const val = obj[field];
  if (val === undefined || val === null) return;
  if (typeof val !== 'number') {
    errors.push(`${label} must be a number or null, got ${typeof val} "${val}"`);
  }
}

function throwIfErrors(errors: string[], result: unknown): void {
  if (errors.length === 0) return;
  log.error('Model output failed validation', { event: 'OUTPUT_VALIDATION_FAILED', errors });
  throw new OutputValidationError(errors);
}
