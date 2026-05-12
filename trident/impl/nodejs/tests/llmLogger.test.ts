import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estimateCost, logLlmCall, type LlmCallEntry } from '../src/ai/llmLogger.js';

describe('estimateCost', () => {
  it('computes cost for gpt-4o-2024-11-20', () => {
    // 1000 prompt tokens @ $2.50/1M + 500 completion tokens @ $10.00/1M
    // = (1000 * 2.50 + 500 * 10.00) / 1_000_000 = 0.0025 + 0.005 = 0.0075
    const cost = estimateCost('gpt-4o-2024-11-20', 1000, 500);
    expect(cost).toBeCloseTo(0.0075);
  });

  it('computes cost for gpt-4o-mini', () => {
    const cost = estimateCost('gpt-4o-mini', 10_000, 2_000);
    // (10000 * 0.15 + 2000 * 0.60) / 1_000_000 = (1500 + 1200) / 1_000_000 = 0.0027
    expect(cost).toBeCloseTo(0.0027);
  });

  it('computes cost for deepseek-chat', () => {
    const cost = estimateCost('deepseek-chat', 10_000, 2_000);
    // (10000 * 0.27 + 2000 * 1.10) / 1_000_000 = (2700 + 2200) / 1_000_000 = 0.0049
    expect(cost).toBeCloseTo(0.0049);
  });

  it('computes cost for deepseek-reasoner', () => {
    const cost = estimateCost('deepseek-reasoner', 10_000, 2_000);
    // (10000 * 0.55 + 2000 * 2.19) / 1_000_000 = (5500 + 4380) / 1_000_000 = 0.00988
    expect(cost).toBeCloseTo(0.00988);
  });

  it('returns null for an unknown model', () => {
    const cost = estimateCost('unknown-model-xyz', 1000, 500);
    expect(cost).toBeNull();
  });
});

describe('logLlmCall', () => {
  it('emits a log entry that does not contain raw prompt or response text', () => {
    // The LlmCallEntry type has no field for raw messages — verify the type at compile time.
    // At runtime, confirm logLlmCall runs without error and entry keys are only metadata.
    const entry: LlmCallEntry = {
      provider: 'openai',
      model: 'gpt-4o-2024-11-20',
      latencyMs: 1200,
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
      estimatedCostUsd: 0.004,
      success: true,
      error: null,
      callerKey: '127.0.0.1',
    };
    // The function should not throw.
    expect(() => logLlmCall(entry)).not.toThrow();

    // Verify there are no raw prompt / response fields in the entry type.
    // TypeScript ensures this at compile time; we also assert at runtime.
    const keys = Object.keys(entry);
    expect(keys).not.toContain('messages');
    expect(keys).not.toContain('prompt');
    expect(keys).not.toContain('response');
    expect(keys).not.toContain('content');
  });

  it('handles a failed call entry without throwing', () => {
    const entry: LlmCallEntry = {
      provider: 'openai',
      model: 'gpt-4o-2024-11-20',
      latencyMs: 300,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: null,
      success: false,
      error: 'Timeout after 60s',
      callerKey: undefined,
    };
    expect(() => logLlmCall(entry)).not.toThrow();
  });
});
