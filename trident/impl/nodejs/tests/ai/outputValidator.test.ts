import { describe, it, expect } from 'vitest';
import { validateExtractionResult, OutputValidationError } from '../../src/ai/outputValidator.js';
import type { ExtractionResult } from '../../src/ai/types.js';

function makeValid(): ExtractionResult {
  return {
    signal: {
      schema_version: '1.0',
      meta: {
        date: '2026-05-09',
        timestamp: '10:06',
        update_seq: 1,
        futures_last: 5234.50,
        cash_last: 5190.00,
        basis: 44.50,
        execution_instrument: 'US500.cash',
      },
      volatility: {
        dvs: 62,
        dvs_prior: null as unknown as number, // null is valid per schema
        skew: 134,
        regime: 'normal',
      },
      vwap: { value: null as unknown as number, updated_at: null as unknown as string, source: 'manual' },
      ranges: { range_1_up: 5340, range_2_up: 5290, range_2_down: 5140, range_1_down: 5090 },
      levels: {
        level_time: '10:06',
        max_sell_1: 5247,
        max_sell_2: 5230,
        max_buy_1: 5183,
        max_buy_2: 5198,
        additional: [],
      },
      levels_recal: {
        level_time: null,
        max_sell_1: null,
        max_sell_2: null,
        max_buy_1: null,
        max_buy_2: null,
        additional: [],
      },
      bias: { direction: null as unknown as 'long' },
    },
    notes: ['Meta extracted successfully'],
    warnings: ['VWAP must be entered manually'],
    provider: 'openai',
    model: 'gpt-4o-2024-11-20',
    usage: { inputTokens: 1000, outputTokens: 200 },
  };
}

describe('validateExtractionResult', () => {
  it('accepts a well-formed result', () => {
    expect(() => validateExtractionResult(makeValid())).not.toThrow();
  });

  it('returns the result typed as ExtractionResult on success', () => {
    const result = validateExtractionResult(makeValid());
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o-2024-11-20');
  });

  it('rejects a numeric field returned as a string', () => {
    const bad = makeValid();
    (bad.signal.volatility as unknown as Record<string, unknown>)['dvs'] = '62';
    expect(() => validateExtractionResult(bad)).toThrowError(OutputValidationError);
    try {
      validateExtractionResult(bad);
    } catch (err) {
      expect((err as OutputValidationError).errors[0]).toMatch(/dvs/);
    }
  });

  it('rejects a price level returned as a string', () => {
    const bad = makeValid();
    (bad.signal.levels as unknown as Record<string, unknown>)['max_sell_1'] = '6582';
    expect(() => validateExtractionResult(bad)).toThrowError(OutputValidationError);
  });

  it('rejects an invalid bias.direction enum value', () => {
    const bad = makeValid();
    (bad.signal.bias as unknown as Record<string, unknown>)['direction'] = 'bullish';
    expect(() => validateExtractionResult(bad)).toThrowError(OutputValidationError);
    try {
      validateExtractionResult(bad);
    } catch (err) {
      expect((err as OutputValidationError).errors[0]).toMatch(/direction/);
    }
  });


  it('rejects an invalid volatility.regime enum value', () => {
    const bad = makeValid();
    (bad.signal.volatility as unknown as Record<string, unknown>)['regime'] = 'low';
    expect(() => validateExtractionResult(bad)).toThrowError(OutputValidationError);
  });

  it('rejects dvs value outside 0–200', () => {
    const bad = makeValid();
    (bad.signal.volatility as unknown as Record<string, unknown>)['dvs'] = 350;
    expect(() => validateExtractionResult(bad)).toThrowError(OutputValidationError);
    try {
      validateExtractionResult(bad);
    } catch (err) {
      expect((err as OutputValidationError).errors[0]).toMatch(/dvs out of range/);
    }
  });

  it('accepts null values for nullable fields', () => {
    const valid = makeValid();
    // max_buy_1, vwap.value, etc. are already null in makeValid() — should pass
    expect(() => validateExtractionResult(valid)).not.toThrow();
  });

  it('rejects schema_version other than "1.0"', () => {
    const bad = makeValid();
    (bad.signal as unknown as Record<string, unknown>)['schema_version'] = '2.0';
    expect(() => validateExtractionResult(bad)).toThrowError(OutputValidationError);
  });
});
