import type { SignalFile } from '../signal/types.js';

/**
 * One image as the AI provider sees it: raw bytes + MIME type.
 * The provider is responsible for any base64 / data-URL encoding it needs.
 */
export interface ImageInput {
  bytes: Buffer;
  mimeType: string;
  /** Optional: original filename for prompt context / logs (not required). */
  filename?: string;
}

/**
 * Structured outcome of running screenshots through a vision model.
 *
 * `signal` is the partial SignalFile the model produced. Fields the model
 * could not see should be `null`/missing — never invented. Server-side code
 * may merge defaults afterwards (e.g. `execution_instrument: 'US500.cash'`).
 *
 * `notes` are human-readable summaries of what was extracted (one bullet per
 * field group). `warnings` are conditions the analyst should know about
 * (DVS gate, missing levels, regime mismatch, etc).
 */
export interface ExtractionResult {
  signal: Partial<SignalFile>;
  notes: string[];
  warnings: string[];
  /** Provider name for telemetry / debugging. */
  provider: string;
  /** Model identifier used (e.g. `gpt-4o-2024-11-20`). */
  model: string;
  /** Provider-reported usage if available (input/output tokens). */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

/**
 * Vision-capable LLM provider that extracts a structured signal from
 * screenshots. Implementations swap the underlying API surface (OpenAI,
 * Anthropic, Gemini, …) but expose the same contract to the rest of Trident.
 */
export interface VisionProvider {
  /** Display name, used in logs and the ExtractionResult. */
  readonly name: string;

  /** Model identifier the provider will use for the call. */
  readonly model: string;

  /**
   * Run the extraction. Throws on transport / parsing errors so the caller
   * can decide whether to surface them to the UI or fall back.
   */
  extractSignal(images: ImageInput[], systemPrompt: string): Promise<ExtractionResult>;
}
