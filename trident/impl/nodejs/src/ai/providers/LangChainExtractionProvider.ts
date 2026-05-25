import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AIMessage } from '@langchain/core/messages';

import type { ImageInput, ExtractionResult, VisionProvider } from '../types.js';
import { getLogger } from '../../logger.js';

const log = getLogger('LangChainExtractionProvider');

/**
 * JSON Schema for structured output — mirrors SignalFile with every numeric
 * field as ["number","null"] so the model can mark what it couldn't see.
 * Server-side normalisation stamps schema_version, execution_instrument,
 * update_seq, levels.additional, and vwap.source after the call.
 */
const SIGNAL_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    notes:    { type: 'array', items: { type: 'string' } },
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

export interface LangChainExtractionProviderOpts {
  apiKey: string;
  model?: string;
  baseURL?: string;
  timeoutMs?: number;
}

/**
 * Vision provider backed by LangChain's ChatOpenAI with .withStructuredOutput().
 * Drop-in replacement for OpenAIProvider — implements the same VisionProvider
 * interface and accepts the same constructor options.
 *
 * Uses includeRaw: true to retain token usage from the underlying AIMessage.
 * LangSmith tracing is suppressed (no account or API key needed).
 */
export class LangChainExtractionProvider implements VisionProvider {
  readonly name = 'openai';
  readonly model: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly structuredLlm: any;

  constructor(opts: LangChainExtractionProviderOpts) {
    process.env.LANGCHAIN_TRACING_V2 ??= 'false';

    this.model = opts.model ?? 'gpt-4o-2024-11-20';

    const llm = new ChatOpenAI({
      model: this.model,
      apiKey: opts.apiKey,
      configuration: opts.baseURL ? { baseURL: opts.baseURL } : undefined,
      temperature: 0,
      timeout: opts.timeoutMs ?? 60_000,
    });

    this.structuredLlm = llm.withStructuredOutput(SIGNAL_TOOL_SCHEMA, {
      name: 'return_extracted_signal',
      includeRaw: true,
    });
  }

  async extractSignal(images: ImageInput[], systemPrompt: string): Promise<ExtractionResult> {
    if (images.length === 0) {
      throw new Error('LangChainExtractionProvider: no images provided');
    }
    log.info('Calling vision API via LangChain', { model: this.model, imageCount: images.length });

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage({
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
      }),
    ];

    const response = await this.structuredLlm.invoke(messages);
    const raw = response.raw as AIMessage;
    const parsed = response.parsed as { signal: unknown; notes: string[]; warnings: string[] };

    if (!parsed || !parsed.signal) {
      throw new Error('LangChainExtractionProvider: structured output missing signal field');
    }

    return {
      signal: parsed.signal as ExtractionResult['signal'],
      notes:    Array.isArray(parsed.notes)    ? parsed.notes    : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      provider: this.name,
      model:    this.model,
      usage: raw.usage_metadata
        ? {
            inputTokens:  raw.usage_metadata.input_tokens,
            outputTokens: raw.usage_metadata.output_tokens,
          }
        : undefined,
    };
  }
}
