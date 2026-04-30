import type { ImageInput, ExtractionResult, VisionProvider } from './types.js';
import { SIGNAL_EXTRACTION_PROMPT } from './prompts/signalExtractionPrompt.js';
import { checkBeforeCall, recordUsage } from './guardrail.js';
import { getLogger } from '../logger.js';

const log = getLogger('signalExtractor');

export interface ExtractOpts {
  callerKey?: string;
}

/**
 * Orchestrates a screenshot → signal extraction:
 *   1. Asks the guardrail whether to proceed.
 *   2. Calls the provider with the canonical Trident prompt.
 *   3. Normalises the result (defaults that the model never sees).
 *   4. Records usage for the guardrail.
 */
export class SignalExtractor {
  constructor(private readonly provider: VisionProvider) {}

  async extract(images: ImageInput[], opts: ExtractOpts = {}): Promise<ExtractionResult> {
    const totalBytes = images.reduce((acc, i) => acc + i.bytes.length, 0);
    const ctx = { imageCount: images.length, totalBytes, callerKey: opts.callerKey };

    const decision = await checkBeforeCall(ctx);
    if (!decision.allow) {
      throw new Error(`Extraction blocked: ${decision.reason ?? 'guardrail veto'}`);
    }

    const t0 = Date.now();
    const raw = await this.provider.extractSignal(images, SIGNAL_EXTRACTION_PROMPT);
    const elapsedMs = Date.now() - t0;
    log.info('Extraction complete', {
      provider: raw.provider,
      model: raw.model,
      elapsedMs,
      inputTokens: raw.usage?.inputTokens,
      outputTokens: raw.usage?.outputTokens,
      noteCount: raw.notes.length,
      warningCount: raw.warnings.length,
    });

    const normalised = normalise(raw);
    await recordUsage(ctx, normalised);
    return normalised;
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
