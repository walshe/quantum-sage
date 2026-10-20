import OpenAI from 'openai';
import type { ImageInput, ExtractionResult, VisionProvider } from '../types.js';
import { SIGNAL_TOOL_SCHEMA } from './LangChainExtractionProvider.js';
import { getLogger } from '../../logger.js';

const log = getLogger('OpenRouterExtractionProvider');

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const TOOL_NAME = 'return_extracted_signal';

/** How structured output is requested from the model. */
type OutputMode = 'forced-tool' | 'auto-tool';

type ChatMessages = OpenAI.Chat.Completions.ChatCompletionMessageParam[];
type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;

export interface OpenRouterExtractionProviderOpts {
  apiKey: string;
  /** OpenRouter model slug, e.g. `anthropic/claude-sonnet-4.6` or `openai/gpt-4o`. */
  model?: string;
  baseURL?: string;
  timeoutMs?: number;
}

/**
 * True when the provider rejected the request because the model does not
 * support a forced `tool_choice` (e.g. Claude Sonnet 5.5: `tool_choice: type
 * "tool" and "any" are not supported for this model`). OpenRouter wraps the
 * upstream message in `error.metadata.raw`, so we match on the serialised body.
 */
function isForcedToolChoiceUnsupported(err: unknown): boolean {
  const e = err as { status?: number; error?: unknown; message?: string };
  if (e?.status !== 400) return false;
  const body = JSON.stringify(e.error ?? '') + (e.message ?? '');
  return /tool_choice/i.test(body) && /not supported/i.test(body);
}

/**
 * Vision provider backed by OpenRouter — one API key and one bill for every
 * model vendor. OpenRouter speaks the OpenAI Chat Completions protocol, so we
 * use the `openai` SDK with a different base URL.
 *
 * Structured output comes from the `return_extracted_signal` tool (same schema
 * as the other providers):
 *   1. Forced via `tool_choice` — guarantees a tool call; the default.
 *   2. `tool_choice: "auto"` — used automatically when the model rejects a
 *      forced `tool_choice` (e.g. Claude Sonnet 5.5). The prompt still demands
 *      the tool, and a prose reply throws as before. The fallback is remembered
 *      for the lifetime of the provider, so later calls skip the failed attempt.
 *
 * `response_format: json_schema` is not used: Claude caps strict schemas at 16
 * nullable/union parameters and the signal schema has 29.
 *
 * Switching model is a config change only: set `OPENROUTER_MODEL` to any
 * vision-capable slug.
 */
export class OpenRouterExtractionProvider implements VisionProvider {
  readonly name = 'openrouter';
  readonly model: string;
  private readonly client: OpenAI;
  private mode: OutputMode = 'forced-tool';

  constructor(opts: OpenRouterExtractionProviderOpts) {
    this.model = opts.model ?? 'anthropic/claude-sonnet-4.6';
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL ?? OPENROUTER_BASE_URL,
      timeout: opts.timeoutMs ?? 60_000,
      // Optional OpenRouter attribution header — shows "Trident" in the OpenRouter dashboard.
      defaultHeaders: { 'X-Title': 'Trident' },
    });
  }

  async extractSignal(images: ImageInput[], systemPrompt: string): Promise<ExtractionResult> {
    if (images.length === 0) {
      throw new Error('OpenRouterExtractionProvider: no images provided');
    }
    log.info('Calling vision API via OpenRouter', { model: this.model, imageCount: images.length, mode: this.mode });

    const messages: ChatMessages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Extract the signal from the attached screenshots. Call ' +
              '`return_extracted_signal` with the structured result. ' +
              'Do not reply with prose.',
          },
          ...images.map(img => ({
            type: 'image_url' as const,
            image_url: {
              url: `data:${img.mimeType};base64,${img.bytes.toString('base64')}`,
              detail: 'high' as const,
            },
          })),
        ],
      },
    ];

    // Capture the mode per call: concurrent calls may all fail in forced mode
    // after another one has already flipped `this.mode`, and each must still retry.
    const mode = this.mode;
    let response: ChatCompletion;
    try {
      response = await this.requestTool(messages, mode);
    } catch (err) {
      if (mode !== 'forced-tool' || !isForcedToolChoiceUnsupported(err)) throw err;
      log.warn('Model does not support forced tool_choice — falling back to tool_choice "auto"', { model: this.model });
      this.mode = 'auto-tool';
      response = await this.requestTool(messages, this.mode);
    }
    const rawArgs = this.toolArguments(response);

    let parsed: { signal: unknown; notes: string[]; warnings: string[] };
    try {
      parsed = JSON.parse(rawArgs);
    } catch {
      throw new Error('OpenRouterExtractionProvider: tool call arguments are not valid JSON');
    }

    if (!parsed || !parsed.signal) {
      throw new Error('OpenRouterExtractionProvider: tool input missing signal field');
    }

    return {
      signal:   parsed.signal as ExtractionResult['signal'],
      notes:    Array.isArray(parsed.notes)    ? parsed.notes    : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      provider: this.name,
      model:    this.model,
      usage: response.usage
        ? {
            inputTokens:  response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  }

  private requestTool(messages: ChatMessages, mode: OutputMode): Promise<ChatCompletion> {
    return this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      max_tokens: 4096,
      messages,
      tools: [
        {
          type: 'function',
          function: {
            name: TOOL_NAME,
            description: 'Return the structured signal extracted from the IV Smile chart screenshot.',
            parameters: SIGNAL_TOOL_SCHEMA as unknown as Record<string, unknown>,
          },
        },
      ],
      // Force the model to call the tool where supported; otherwise let it choose
      // (the prompt demands the tool, and toolArguments() rejects prose replies).
      tool_choice: mode === 'forced-tool'
        ? { type: 'function', function: { name: TOOL_NAME } }
        : 'auto',
    });
  }

  private toolArguments(response: ChatCompletion): string {
    const choice = response.choices[0];
    const toolCall = choice?.message.tool_calls?.find(
      tc => tc.type === 'function' && tc.function.name === TOOL_NAME
    );
    if (!toolCall || toolCall.type !== 'function') {
      throw new Error(
        `OpenRouterExtractionProvider: no ${TOOL_NAME} tool call in response — ` +
        `finish_reason=${choice?.finish_reason}, content=${JSON.stringify(choice?.message.content ?? null)}`
      );
    }
    return toolCall.function.arguments;
  }
}
