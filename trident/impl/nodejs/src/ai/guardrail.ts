import { getLogger } from '../logger.js';

const log = getLogger('Guardrail');

export interface GuardrailContext {
  imageCount: number;
  totalBytes: number;
  /** Any analyst-supplied text string that will be included in the prompt context. */
  callerKey?: string;
}

export interface GuardrailDecision {
  allowed: boolean;
  reason?: string;
}

export interface UsageRecord {
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number | null;
  success: boolean;
  validationFailed: boolean;
}

export interface SessionMetrics {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  validationFailures: number;
  injectionBlocks: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  totalCostUsd: number;
  successRate: number;
}

// ── Injection patterns (multi-word phrases only, checked case-insensitively) ──

const INJECTION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'ignore_previous_instructions', pattern: /ignore\s+previous\s+instructions/i },
  { label: 'disregard_system_prompt',      pattern: /disregard\s+your\s+system\s+prompt/i },
  { label: 'you_are_now',                  pattern: /you\s+are\s+now/i },
  { label: 'forget_everything',            pattern: /forget\s+everything/i },
  { label: 'act_as',                       pattern: /act\s+as/i },
];

// ── Module-level session stats (accumulates across the lifetime of the process) ──

interface StatsStore {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  validationFailures: number;
  injectionBlocks: number;
  latencySamples: number[];
  totalCostUsd: number;
}

const stats: StatsStore = {
  totalCalls: 0,
  successCount: 0,
  failureCount: 0,
  validationFailures: 0,
  injectionBlocks: 0,
  latencySamples: [],
  totalCostUsd: 0,
};

// ── Public API ────────────────────────────────────────────────────────────────

/** Called BEFORE the provider call. Screens text inputs for injection patterns. */
export function checkBeforeCall(ctx: GuardrailContext): GuardrailDecision {
  stats.totalCalls++;

  const textInputs = [ctx.callerKey].filter((s): s is string => typeof s === 'string');

  for (const text of textInputs) {
    for (const { label, pattern } of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        stats.injectionBlocks++;
        log.warn('Injection pattern detected', { event: 'INJECTION_BLOCKED', patternCategory: label, callerKey: ctx.callerKey });
        return { allowed: false, reason: label };
      }
    }
  }

  return { allowed: true };
}

/** Called AFTER each provider call (success or failure) to accumulate session stats. */
export function recordUsage(record: UsageRecord): void {
  if (record.success) {
    stats.successCount++;
    stats.latencySamples.push(record.latencyMs);
    if (record.estimatedCostUsd !== null) {
      stats.totalCostUsd += record.estimatedCostUsd;
    }
  } else {
    stats.failureCount++;
    if (record.validationFailed) {
      stats.validationFailures++;
    }
  }
}

/** Returns a snapshot of the current session metrics (p50/p95 computed on demand). */
export function getMetrics(): SessionMetrics {
  const { totalCalls, successCount, failureCount, validationFailures, injectionBlocks, latencySamples, totalCostUsd } = stats;
  const p50 = percentile(latencySamples, 50);
  const p95 = percentile(latencySamples, 95);
  return {
    totalCalls,
    successCount,
    failureCount,
    validationFailures,
    injectionBlocks,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    totalCostUsd,
    successRate: totalCalls > 0 ? successCount / totalCalls : 0,
  };
}

function percentile(samples: number[], pct: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
