import type { ImageInput, ExtractionResult, VisionProvider } from './types.js';
import { SIGNAL_EXTRACTION_PROMPT } from './prompts/signalExtractionPrompt.js';
import { checkBeforeCall, recordUsage, getMetrics } from './guardrail.js';
import { logLlmCall, estimateCost } from './llmLogger.js';
import { validateExtractionResult, OutputValidationError } from './outputValidator.js';
import { getLogger } from '../logger.js';

const log = getLogger('signalExtractor');

export class ExtractionBlockedError extends Error {
  constructor(reason: string) {
    super(`Request blocked: ${reason}`);
    this.name = 'ExtractionBlockedError';
  }
}

export interface ExtractOpts {
  callerKey?: string;
}

/**
 * Orchestrates a screenshot → signal extraction:
 *   1. Asks the guardrail whether to proceed (injection screening).
 *   2. Calls the provider with the canonical Trident prompt.
 *   3. Validates the response shape and ranges.
 *   4. Normalises the result (defaults that the model never sees).
 *   5. Logs the call and records usage metrics.
 */
export class SignalExtractor {
  constructor(private readonly provider: VisionProvider) {}

  async extract(images: ImageInput[], opts: ExtractOpts = {}): Promise<ExtractionResult> {
    const totalBytes = images.reduce((acc, i) => acc + i.bytes.length, 0);
    const ctx = { imageCount: images.length, totalBytes, callerKey: opts.callerKey };

    const decision = checkBeforeCall(ctx);
    if (!decision.allowed) {
      throw new ExtractionBlockedError(decision.reason ?? 'guardrail veto');
    }

    const t0 = Date.now();
    let raw: ExtractionResult | undefined;

    try {
      raw = await this.provider.extractSignal(images, SIGNAL_EXTRACTION_PROMPT);
      const latencyMs = Date.now() - t0;

      validateExtractionResult(raw);

      const normalised = normalise(raw);

      const promptTokens = raw.usage?.inputTokens ?? 0;
      const completionTokens = raw.usage?.outputTokens ?? 0;
      const estimatedCostUsd = estimateCost(raw.model, promptTokens, completionTokens);

      logLlmCall({
        provider: raw.provider,
        model: raw.model,
        latencyMs,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCostUsd,
        success: true,
        error: null,
        callerKey: opts.callerKey,
      });

      recordUsage({ latencyMs, promptTokens, completionTokens, estimatedCostUsd, success: true, validationFailed: false });

      log.info('Extraction complete', {
        provider: raw.provider,
        model: raw.model,
        latencyMs,
        inputTokens: raw.usage?.inputTokens,
        outputTokens: raw.usage?.outputTokens,
        noteCount: raw.notes.length,
        warningCount: raw.warnings.length,
      });

      return normalised;
    } catch (err) {
      const latencyMs = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      const validationFailed = err instanceof OutputValidationError;

      logLlmCall({
        provider: raw?.provider ?? 'unknown',
        model: raw?.model ?? 'unknown',
        latencyMs,
        promptTokens: raw?.usage?.inputTokens ?? 0,
        completionTokens: raw?.usage?.outputTokens ?? 0,
        totalTokens: (raw?.usage?.inputTokens ?? 0) + (raw?.usage?.outputTokens ?? 0),
        estimatedCostUsd: null,
        success: false,
        error: errorMsg,
        callerKey: opts.callerKey,
      });

      recordUsage({
        latencyMs,
        promptTokens: raw?.usage?.inputTokens ?? 0,
        completionTokens: raw?.usage?.outputTokens ?? 0,
        estimatedCostUsd: null,
        success: false,
        validationFailed,
      });

      throw err;
    }
  }

  /** Emits a session-summary log entry with accumulated AI quality metrics. */
  flushMetrics(): void {
    const metrics = getMetrics();
    log.info('AI session metrics', {
      event: 'AI_SESSION_METRICS',
      totalCalls: metrics.totalCalls,
      successCount: metrics.successCount,
      failureCount: metrics.failureCount,
      validationFailures: metrics.validationFailures,
      injectionBlocks: metrics.injectionBlocks,
      p50LatencyMs: metrics.p50LatencyMs,
      p95LatencyMs: metrics.p95LatencyMs,
      totalCostUsd: metrics.totalCostUsd,
      successRate: metrics.successRate,
    });
  }
}

/**
 * Stamp the fields the model isn't allowed to invent so the response is
 * always loadable into the form / validatable as a SignalFile.
 */
function normalise(result: ExtractionResult): ExtractionResult {
  const signal = (result.signal ?? {}) as Record<string, unknown>;
  // schema_version is always "1.0".
  signal.schema_version = '1.0';
  // execution_instrument is always US500.cash.
  const meta = (signal.meta ?? {}) as Record<string, unknown>;
  meta.execution_instrument = 'US500.cash';
  if (meta.update_seq == null) meta.update_seq = 1;
  signal.meta = meta;
  // levels.additional must be an array.
  const levels = (signal.levels ?? {}) as Record<string, unknown>;
  if (!Array.isArray(levels.additional)) levels.additional = [];
  signal.levels = levels;
  // VWAP source default.
  const vwap = (signal.vwap ?? {}) as Record<string, unknown>;
  if (!vwap.source) vwap.source = 'manual';
  signal.vwap = vwap;
  return { ...result, signal: signal as ExtractionResult['signal'] };
}
