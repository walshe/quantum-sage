import type { ExtractionResult } from './types.js';

/**
 * Hook for cost / rate-limit / abuse guardrails around AI extraction calls.
 *
 * Today this is a no-op — every call is allowed and post-call usage is
 * just logged. Wire real budget tracking, daily caps, IP throttling,
 * etc. through this module so the call sites stay clean.
 */

export interface GuardrailContext {
  imageCount: number;
  totalBytes: number;
  /** Identifier the rate limiter would key on (IP, session, …). */
  callerKey?: string;
}

export interface GuardrailDecision {
  allow: boolean;
  /** Human-readable reason if `allow=false`, surfaced to the UI. */
  reason?: string;
}

/** Called BEFORE the provider call. Veto with `allow: false` to short-circuit. */
export async function checkBeforeCall(_ctx: GuardrailContext): Promise<GuardrailDecision> {
  return { allow: true };
}

/** Called AFTER a successful provider call so usage can be recorded. */
export async function recordUsage(_ctx: GuardrailContext, _result: ExtractionResult): Promise<void> {
  // No-op for now. Future: log cost telemetry, deduct from a daily budget,
  // forward to CostTrackingService-equivalent.
}
