import { getLogger } from '../logger.js';

const log = getLogger('LLMLogger');

export interface LlmCallEntry {
  provider: string;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  success: boolean;
  error: string | null;
  callerKey: string | undefined;
}

// ── Cost rate table (keyed by model ID, USD per 1M tokens) ───────────────────

interface ModelRate {
  inputPer1MTokens: number;
  outputPer1MTokens: number;
}

const COST_RATES: Record<string, ModelRate> = {
  'gpt-4o-2024-11-20': { inputPer1MTokens: 2.50,  outputPer1MTokens: 10.00 },
  'gpt-4o-mini':       { inputPer1MTokens: 0.15,  outputPer1MTokens: 0.60  },
  'deepseek-chat':     { inputPer1MTokens: 0.27,  outputPer1MTokens: 1.10  },
  'deepseek-reasoner': { inputPer1MTokens: 0.55,  outputPer1MTokens: 2.19  },
};

export function estimateCost(model: string, promptTokens: number, completionTokens: number): number | null {
  const rate = COST_RATES[model];
  if (!rate) {
    log.warn('Unknown model in cost rate table — estimatedCostUsd will be null', { model });
    return null;
  }
  return (promptTokens * rate.inputPer1MTokens + completionTokens * rate.outputPer1MTokens) / 1_000_000;
}

export function logLlmCall(entry: LlmCallEntry): void {
  log.info('LLM call recorded', {
    event: 'LLM_CALL',
    provider: entry.provider,
    model: entry.model,
    latencyMs: entry.latencyMs,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    totalTokens: entry.totalTokens,
    estimatedCostUsd: entry.estimatedCostUsd,
    success: entry.success,
    error: entry.error,
    callerKey: entry.callerKey ?? null,
  });
}
