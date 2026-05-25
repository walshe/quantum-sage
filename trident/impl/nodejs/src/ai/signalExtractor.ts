import type { ImageInput, ExtractionResult, VisionProvider } from './types.js';
import { SIGNAL_EXTRACTION_PROMPT } from './prompts/signalExtractionPrompt.js';
import { recordUsage, getMetrics } from './guardrail.js';
import { logLlmCall, estimateCost } from './llmLogger.js';
import { OutputValidationError } from './outputValidator.js';
import { buildExtractionGraph } from './extractionGraph.js';
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
 * Orchestrates a screenshot → signal extraction via a LangGraph state graph:
 *   guardrail → llm-call → validate → normalise
 *
 * Logging and metrics recording remain here (not in graph nodes) because they
 * are session-scoped cross-cutting concerns, not pipeline data transforms.
 */
export class SignalExtractor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly graph: any;

  constructor(private readonly provider: VisionProvider) {
    this.graph = buildExtractionGraph(provider);
  }

  async extract(images: ImageInput[], opts: ExtractOpts = {}): Promise<ExtractionResult> {
    const t0 = Date.now();

    const finalState = await this.graph.invoke({
      images,
      callerKey:    opts.callerKey,
      systemPrompt: SIGNAL_EXTRACTION_PROMPT,
      result:        undefined,
      error:         undefined,
      blocked:       false,
      blockedReason: undefined,
      t0,
    });

    const latencyMs = Date.now() - t0;

    // Guardrail blocked — no LLM call was made; guardrail.ts already incremented injectionBlocks
    if (finalState.blocked) {
      throw new ExtractionBlockedError(finalState.blockedReason ?? 'guardrail veto');
    }

    const raw: ExtractionResult | undefined = finalState.result;
    const err: Error | undefined            = finalState.error;

    if (err) {
      const validationFailed = err instanceof OutputValidationError;
      logLlmCall({
        provider: raw?.provider ?? 'unknown',
        model:    raw?.model    ?? 'unknown',
        latencyMs,
        promptTokens:    raw?.usage?.inputTokens  ?? 0,
        completionTokens: raw?.usage?.outputTokens ?? 0,
        totalTokens: (raw?.usage?.inputTokens ?? 0) + (raw?.usage?.outputTokens ?? 0),
        estimatedCostUsd: null,
        success: false,
        error:   err.message,
        callerKey: opts.callerKey,
      });
      recordUsage({
        latencyMs,
        promptTokens:     raw?.usage?.inputTokens  ?? 0,
        completionTokens: raw?.usage?.outputTokens ?? 0,
        estimatedCostUsd: null,
        success:         false,
        validationFailed,
      });
      throw err;
    }

    if (!raw) {
      throw new Error('SignalExtractor: graph completed without result or error');
    }

    const promptTokens     = raw.usage?.inputTokens  ?? 0;
    const completionTokens = raw.usage?.outputTokens ?? 0;
    const estimatedCostUsd = estimateCost(raw.model, promptTokens, completionTokens);

    logLlmCall({
      provider: raw.provider,
      model:    raw.model,
      latencyMs,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCostUsd,
      success: true,
      error:   null,
      callerKey: opts.callerKey,
    });

    recordUsage({ latencyMs, promptTokens, completionTokens, estimatedCostUsd, success: true, validationFailed: false });

    log.info('Extraction complete', {
      provider: raw.provider,
      model:    raw.model,
      latencyMs,
      inputTokens:  raw.usage?.inputTokens,
      outputTokens: raw.usage?.outputTokens,
      noteCount:    raw.notes.length,
      warningCount: raw.warnings.length,
    });

    return raw;
  }

  /** Emits a session-summary log entry with accumulated AI quality metrics. */
  flushMetrics(): void {
    const metrics = getMetrics();
    log.info('AI session metrics', {
      event: 'AI_SESSION_METRICS',
      totalCalls:       metrics.totalCalls,
      successCount:     metrics.successCount,
      failureCount:     metrics.failureCount,
      validationFailures: metrics.validationFailures,
      injectionBlocks:  metrics.injectionBlocks,
      p50LatencyMs:     metrics.p50LatencyMs,
      p95LatencyMs:     metrics.p95LatencyMs,
      totalCostUsd:     metrics.totalCostUsd,
      successRate:      metrics.successRate,
    });
  }
}

/**
 * Stamp the fields the model isn't allowed to invent so the response is
 * always loadable into the form / validatable as a SignalFile.
 * Exported for use in the LangGraph normalise node.
 */
export function normalise(result: ExtractionResult): ExtractionResult {
  const signal = (result.signal ?? {}) as Record<string, unknown>;
  signal.schema_version = '1.0';
  const meta = (signal.meta ?? {}) as Record<string, unknown>;
  meta.execution_instrument = 'US500.cash';
  if (meta.update_seq == null) meta.update_seq = 1;
  signal.meta = meta;
  const levels = (signal.levels ?? {}) as Record<string, unknown>;
  if (!Array.isArray(levels.additional)) levels.additional = [];
  signal.levels = levels;
  const vwap = (signal.vwap ?? {}) as Record<string, unknown>;
  if (!vwap.source) vwap.source = 'manual';
  signal.vwap = vwap;
  return { ...result, signal: signal as ExtractionResult['signal'] };
}
