import Anthropic from '@anthropic-ai/sdk';
import type { ImageInput, ExtractionResult, VisionProvider } from '../types.js';
import { getLogger } from '../../logger.js';

const log = getLogger('ClaudeExtractionProvider');

/**
 * JSON Schema for the `return_extracted_signal` tool.
 * Mirrors SIGNAL_TOOL_SCHEMA in LangChainExtractionProvider — kept in sync manually.
 */
const SIGNAL_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    notes:    { type: 'array' as const, items: { type: 'string' as const } },
    warnings: { type: 'array' as const, items: { type: 'string' as const } },
    signal: {
      type: 'object' as const,
      properties: {
        meta: {
          type: 'object' as const,
          properties: {
            date:                 { type: ['string', 'null'] },
            timestamp:            { type: ['string', 'null'] },
            update_seq:           { type: ['number', 'null'] },
            contract:             { type: ['string', 'null'] },
            futures_last:         { type: ['number', 'null'] },
            cash_last:            { type: ['number', 'null'] },
            basis:                { type: ['number', 'null'] },
            execution_instrument: { type: 'string' as const, enum: ['US500.cash'] },
          },
          required: ['date', 'timestamp', 'futures_last', 'cash_last', 'basis', 'execution_instrument'],
        },
        volatility: {
          type: 'object' as const,
          properties: {
            dvs:       { type: ['number', 'null'] },
            dvs_prior: { type: ['number', 'null'] },
            skew:      { type: ['number', 'null'] },
            regime:    { type: ['string', 'null'], enum: ['compressed', 'normal', 'elevated', 'extreme', null] },
          },
          required: ['dvs', 'dvs_prior', 'skew', 'regime'],
        },
        vwap: {
          type: 'object' as const,
          properties: {
            value:      { type: ['number', 'null'] },
            updated_at: { type: ['string', 'null'] },
            source:     { type: 'string' as const, enum: ['manual'] },
          },
          required: ['value', 'updated_at', 'source'],
        },
        ranges: {
          type: 'object' as const,
          properties: {
            range_1_up:   { type: ['number', 'null'] },
            range_2_up:   { type: ['number', 'null'] },
            range_2_down: { type: ['number', 'null'] },
            range_1_down: { type: ['number', 'null'] },
          },
          required: ['range_1_up', 'range_2_up', 'range_2_down', 'range_1_down'],
        },
        levels: {
          type: 'object' as const,
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
          type: 'object' as const,
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
          type: 'object' as const,
          properties: {
            direction:  { type: ['string', 'null'], enum: ['long', 'short', 'neutral', null] },
            confidence: { type: ['string', 'null'], enum: ['low', 'medium', 'high', null] },
            notes:      { type: ['string', 'null'] },
          },
          required: ['direction', 'confidence', 'notes'],
        },
        invalidation: {
          type: 'object' as const,
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
};

export interface ClaudeExtractionProviderOpts {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * Vision provider backed by the Anthropic SDK using tool use for structured output.
 *
 * Key advantages over LangChainExtractionProvider (OpenAI):
 * - Prompt caching: the system prompt is cached (90% cheaper on repeated calls).
 * - Better spatial reasoning on charts with two side-by-side columns.
 *
 * Uses the `return_extracted_signal` tool (same schema as the OpenAI provider)
 * so no downstream changes are needed in SignalExtractor or the server routes.
 */
export class ClaudeExtractionProvider implements VisionProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;
  private readonly timeoutMs: number;

  constructor(opts: ClaudeExtractionProviderOpts) {
    this.model = opts.model ?? 'claude-sonnet-4-6';
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      timeout: this.timeoutMs,
    });
  }

  async extractSignal(images: ImageInput[], systemPrompt: string): Promise<ExtractionResult> {
    if (images.length === 0) {
      throw new Error('ClaudeExtractionProvider: no images provided');
    }
    log.info('Calling vision API via Anthropic', { model: this.model, imageCount: images.length });

    // Build the user message content: text instruction followed by images
    const userContent: Anthropic.MessageParam['content'] = [
      {
        type: 'text',
        text:
          'Extract the signal from the attached screenshots. Call ' +
          '`return_extracted_signal` with the structured result. ' +
          'Do not reply with prose.',
      },
      ...images.map(img => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: img.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: img.bytes.toString('base64'),
        },
      })),
    ];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      // Prompt caching: mark the system prompt as cacheable (5-min TTL).
      // Cuts input token cost by ~90% on repeated calls with the same prompt.
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        {
          name: 'return_extracted_signal',
          description: 'Return the structured signal extracted from the IV Smile chart screenshot.',
          input_schema: SIGNAL_TOOL_SCHEMA,
        },
      ],
      // Force the model to call the tool — no prose responses
      tool_choice: { type: 'tool', name: 'return_extracted_signal' },
      messages: [{ role: 'user', content: userContent }],
    });

    // Extract the tool use block from the response
    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (!toolUseBlock) {
      throw new Error(
        'ClaudeExtractionProvider: no tool_use block in response — ' +
        `stop_reason=${response.stop_reason}, content=${JSON.stringify(response.content)}`
      );
    }

    const parsed = toolUseBlock.input as { signal: unknown; notes: string[]; warnings: string[] };

    if (!parsed || !parsed.signal) {
      throw new Error('ClaudeExtractionProvider: tool input missing signal field');
    }

    return {
      signal:   parsed.signal as ExtractionResult['signal'],
      notes:    Array.isArray(parsed.notes)    ? parsed.notes    : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      provider: this.name,
      model:    this.model,
      usage: {
        inputTokens:  response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
