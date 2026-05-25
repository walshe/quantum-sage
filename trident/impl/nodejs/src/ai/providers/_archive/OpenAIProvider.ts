import OpenAI from 'openai';

import type { ImageInput, ExtractionResult, VisionProvider } from '../types.js';
import { getLogger } from '../../logger.js';

const log = getLogger('OpenAIProvider');

/**
 * JSON Schema for the tool the model is forced to call. Mirrors SignalFile
 * but every numeric field is `["number", "null"]` so the model can mark
 * what it couldn't see. We don't include `additional` (always [] server-side)
 * or `schema_version` (always "1.0" server-side) — both are added in the
 * extractor after the call.
 */
const SIGNAL_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    notes: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    signal: {
      type: 'object',
      additionalProperties: false,
      properties: {
        meta: {
          type: 'object',
          additionalProperties: false,
          properties: {
            date:                 { type: ['string', 'null'] },
            timestamp:            { type: ['string', 'null'] },
            update_seq:           { type: ['number', 'null'] },
            contract:             { type: ['string', 'null'] },
            futures_last:         { type: ['number', 'null'] },
            cash_last:            { type: ['number', 'null'] },
            basis:                { type: ['number', 'null'] },
            execution_instrument: { type: 'string', enum: ['US500.cash'] },
          },
          required: ['date', 'timestamp', 'futures_last', 'cash_last', 'basis', 'execution_instrument'],
        },
        volatility: {
          type: 'object',
          additionalProperties: false,
          properties: {
            dvs:       { type: ['number', 'null'] },
            dvs_prior: { type: ['number', 'null'] },
            skew:      { type: ['number', 'null'] },
            regime:    { type: ['string', 'null'], enum: ['compressed', 'normal', 'elevated', 'extreme', null] },
          },
          required: ['dvs', 'dvs_prior', 'skew', 'regime'],
        },
        vwap: {
          type: 'object',
          additionalProperties: false,
          properties: {
            value:      { type: ['number', 'null'] },
            updated_at: { type: ['string', 'null'] },
            source:     { type: 'string', enum: ['manual'] },
          },
          required: ['value', 'updated_at', 'source'],
        },
        // TODO: remove ranges from tool schema once confirmed with FB that ranges.* are
        // redundant with levels.* (auto-derived since 2026-05-12 single-IV-chart workflow).
        ranges: {
          type: 'object',
          additionalProperties: false,
          properties: {
            range_1_up:   { type: ['number', 'null'] },
            range_2_up:   { type: ['number', 'null'] },
            range_2_down: { type: ['number', 'null'] },
            range_1_down: { type: ['number', 'null'] },
          },
          required: ['range_1_up', 'range_2_up', 'range_2_down', 'range_1_down'],
        },
        levels: {
          type: 'object',
          additionalProperties: false,
          properties: {
            level_time:  { type: ['string', 'null'] },
            max_sell_1:  { type: ['number', 'null'] },
            max_sell_2:  { type: ['number', 'null'] },
            max_buy_1:   { type: ['number', 'null'] },
            max_buy_2:   { type: ['number', 'null'] },
            supporto:    { type: ['number', 'null'] },
            resistenza:  { type: ['number', 'null'] },
          },
          required: ['level_time', 'max_sell_1', 'max_sell_2', 'max_buy_1', 'max_buy_2', 'supporto', 'resistenza'],
        },
        levels_recal: {
          type: 'object',
          additionalProperties: false,
          properties: {
            level_time:  { type: ['string', 'null'] },
            max_sell_1:  { type: ['number', 'null'] },
            max_sell_2:  { type: ['number', 'null'] },
            max_buy_1:   { type: ['number', 'null'] },
            max_buy_2:   { type: ['number', 'null'] },
            supporto:    { type: ['number', 'null'] },
            resistenza:  { type: ['number', 'null'] },
          },
          required: ['level_time', 'max_sell_1', 'max_sell_2', 'max_buy_1', 'max_buy_2', 'supporto', 'resistenza'],
        },
        bias: {
          type: 'object',
          additionalProperties: false,
          properties: {
            direction:  { type: ['string', 'null'], enum: ['long', 'short', 'neutral', null] },
            confidence: { type: ['string', 'null'], enum: ['low', 'medium', 'high', null] },
            notes:      { type: ['string', 'null'] },
          },
          required: ['direction', 'confidence', 'notes'],
        },
        invalidation: {
          type: 'object',
          additionalProperties: false,
          properties: {
            void_above: { type: ['number', 'null'] },
            void_below: { type: ['number', 'null'] },
            expiry:     { type: ['string', 'null'] },
            notes:      { type: ['string', 'null'] },
          },
          required: ['void_above', 'void_below', 'expiry', 'notes'],
        },
      },
      required: ['meta', 'volatility', 'vwap', 'ranges', 'levels', 'levels_recal', 'bias', 'invalidation'],
    },
  },
  required: ['signal', 'notes', 'warnings'],
} as const;

export interface OpenAIProviderOpts {
  apiKey: string;
  model?: string;
  baseURL?: string;
  /** Hard ceiling for the API call. Default 60s. */
  timeoutMs?: number;
}

/**
 * Vision provider that talks to OpenAI's Chat Completions endpoint with
 * `gpt-4o`-class models. Forces JSON via tool calling so we get a typed
 * payload back rather than free-form text.
 */
export class OpenAIProvider implements VisionProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly client: OpenAI;
  private readonly timeoutMs: number;

  constructor(opts: OpenAIProviderOpts) {
    this.model = opts.model ?? 'gpt-4o-2024-11-20';
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      timeout: this.timeoutMs,
    });
  }

  async extractSignal(images: ImageInput[], systemPrompt: string): Promise<ExtractionResult> {
    if (images.length === 0) {
      throw new Error('OpenAIProvider: no images provided');
    }
    log.info('Calling vision API', { model: this.model, imageCount: images.length });

    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
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
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'return_extracted_signal',
            description:
              'Return the structured signal extracted from the screenshots. ' +
              'Numeric fields the model could not see must be null.',
            parameters: SIGNAL_TOOL_SCHEMA as unknown as Record<string, unknown>,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'return_extracted_signal' } },
      // Determinism — same screenshots should give the same numbers back.
      temperature: 0,
    });

    const choice = response.choices[0];
    const toolCall = choice?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.type !== 'function') {
      throw new Error(
        `OpenAIProvider: model did not call the tool. finish_reason=${choice?.finish_reason}`
      );
    }
    let parsed: { signal: unknown; notes: string[]; warnings: string[] };
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (err) {
      throw new Error(
        `OpenAIProvider: failed to parse tool arguments JSON: ${(err as Error).message}`
      );
    }

    return {
      signal: parsed.signal as ExtractionResult['signal'],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      provider: this.name,
      model: this.model,
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  }
}
