import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createMock = vi.fn();
const ctorMock = vi.fn();

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: createMock } };
    constructor(opts: unknown) { ctorMock(opts); }
  },
}));

const { OpenRouterExtractionProvider, OPENROUTER_BASE_URL } = await import(
  '../../src/ai/providers/OpenRouterExtractionProvider.js'
);
const { buildVisionProvider } = await import('../../src/ai/providers/index.js');

const IMAGE = { bytes: Buffer.from('fake'), mimeType: 'image/png' };

function toolCallResponse(args: unknown) {
  return {
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'return_extracted_signal', arguments: JSON.stringify(args) },
        }],
      },
    }],
    usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 },
  };
}

beforeEach(() => {
  createMock.mockReset();
  ctorMock.mockReset();
});

describe('OpenRouterExtractionProvider', () => {
  it('points the OpenAI client at OpenRouter with the default model', () => {
    const provider = new OpenRouterExtractionProvider({ apiKey: 'sk-or-test' });
    expect(provider.name).toBe('openrouter');
    expect(provider.model).toBe('anthropic/claude-sonnet-4.6');
    expect(ctorMock).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'sk-or-test',
      baseURL: OPENROUTER_BASE_URL,
    }));
  });

  it('forces the return_extracted_signal tool and sends images as data URLs', async () => {
    createMock.mockResolvedValue(toolCallResponse({ signal: { meta: {} }, notes: ['n'], warnings: [] }));
    const provider = new OpenRouterExtractionProvider({ apiKey: 'k', model: 'openai/gpt-4o' });

    await provider.extractSignal([IMAGE], 'SYSTEM');

    const req = createMock.mock.calls[0][0];
    expect(req.model).toBe('openai/gpt-4o');
    expect(req.tool_choice).toEqual({ type: 'function', function: { name: 'return_extracted_signal' } });
    expect(req.messages[0]).toEqual({ role: 'system', content: 'SYSTEM' });
    expect(req.messages[1].content[1].image_url.url).toBe(
      `data:image/png;base64,${Buffer.from('fake').toString('base64')}`
    );
  });

  it('parses the tool call arguments into an ExtractionResult with usage', async () => {
    createMock.mockResolvedValue(toolCallResponse({ signal: { meta: { date: '2026-10-19' } }, notes: ['a'], warnings: ['w'] }));
    const provider = new OpenRouterExtractionProvider({ apiKey: 'k' });

    const result = await provider.extractSignal([IMAGE], 'SYSTEM');

    expect(result.signal).toEqual({ meta: { date: '2026-10-19' } });
    expect(result.notes).toEqual(['a']);
    expect(result.warnings).toEqual(['w']);
    expect(result.provider).toBe('openrouter');
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 300 });
  });

  it('throws when the model replies with prose instead of a tool call', async () => {
    createMock.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: 'hello', tool_calls: undefined } }],
    });
    const provider = new OpenRouterExtractionProvider({ apiKey: 'k' });
    await expect(provider.extractSignal([IMAGE], 'S')).rejects.toThrow(/no return_extracted_signal tool call/);
  });

  it('throws when tool arguments are not valid JSON', async () => {
    const res = toolCallResponse({});
    res.choices[0].message.tool_calls[0].function.arguments = '{not json';
    createMock.mockResolvedValue(res);
    const provider = new OpenRouterExtractionProvider({ apiKey: 'k' });
    await expect(provider.extractSignal([IMAGE], 'S')).rejects.toThrow(/not valid JSON/);
  });

  describe('tool_choice "auto" fallback', () => {
    const toolChoiceUnsupported = Object.assign(new Error('400 Provider returned error'), {
      status: 400,
      error: {
        message: 'Provider returned error',
        metadata: { raw: '{"message":"tool_choice: type \\"tool\\" and \\"any\\" are not supported for this model."}' },
      },
    });

    it('retries with tool_choice "auto" when forced tool_choice is unsupported', async () => {
      createMock
        .mockRejectedValueOnce(toolChoiceUnsupported)
        .mockResolvedValueOnce(toolCallResponse({ signal: { meta: { date: '2026-10-20' } }, notes: [], warnings: [] }));
      const provider = new OpenRouterExtractionProvider({ apiKey: 'k', model: 'anthropic/claude-sonnet-5.5' });

      const result = await provider.extractSignal([IMAGE], 'S');

      expect(createMock).toHaveBeenCalledTimes(2);
      const retry = createMock.mock.calls[1][0];
      expect(retry.tool_choice).toBe('auto');
      expect(retry.tools[0].function.name).toBe('return_extracted_signal');
      expect(result.signal).toEqual({ meta: { date: '2026-10-20' } });
    });

    it('remembers the fallback so later calls go straight to tool_choice "auto"', async () => {
      createMock
        .mockRejectedValueOnce(toolChoiceUnsupported)
        .mockResolvedValue(toolCallResponse({ signal: { meta: {} }, notes: [], warnings: [] }));
      const provider = new OpenRouterExtractionProvider({ apiKey: 'k' });

      await provider.extractSignal([IMAGE], 'S');
      await provider.extractSignal([IMAGE], 'S');

      expect(createMock).toHaveBeenCalledTimes(3);
      expect(createMock.mock.calls[2][0].tool_choice).toBe('auto');
    });

    it('falls back for every concurrent call, not just the first', async () => {
      createMock
        .mockRejectedValueOnce(toolChoiceUnsupported)
        .mockRejectedValueOnce(toolChoiceUnsupported)
        .mockRejectedValueOnce(toolChoiceUnsupported)
        .mockResolvedValue(toolCallResponse({ signal: { meta: {} }, notes: [], warnings: [] }));
      const provider = new OpenRouterExtractionProvider({ apiKey: 'k' });

      const results = await Promise.allSettled([1, 2, 3].map(() => provider.extractSignal([IMAGE], 'S')));

      expect(results.every(r => r.status === 'fulfilled')).toBe(true);
      expect(createMock).toHaveBeenCalledTimes(6);
    });

    it('does not fall back on unrelated 400 errors', async () => {
      createMock.mockRejectedValueOnce(Object.assign(new Error('400 bad image'), { status: 400, error: { message: 'bad image' } }));
      const provider = new OpenRouterExtractionProvider({ apiKey: 'k' });

      await expect(provider.extractSignal([IMAGE], 'S')).rejects.toThrow(/bad image/);
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('still throws when the model replies with prose after falling back', async () => {
      createMock
        .mockRejectedValueOnce(toolChoiceUnsupported)
        .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: 'Here are the levels...' } }] });
      const provider = new OpenRouterExtractionProvider({ apiKey: 'k' });

      await expect(provider.extractSignal([IMAGE], 'S')).rejects.toThrow(/no return_extracted_signal tool call/);
    });
  });

  it('throws when no images are provided', async () => {
    const provider = new OpenRouterExtractionProvider({ apiKey: 'k' });
    await expect(provider.extractSignal([], 'S')).rejects.toThrow(/no images/);
  });
});

describe('buildVisionProvider — openrouter', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('returns an OpenRouter provider when selected and keyed', () => {
    process.env.TRIDENT_AI_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.OPENROUTER_MODEL = 'google/gemini-2.5-pro';
    const provider = buildVisionProvider();
    expect(provider?.name).toBe('openrouter');
    expect(provider?.model).toBe('google/gemini-2.5-pro');
  });

  it('returns null when selected without a key', () => {
    process.env.TRIDENT_AI_PROVIDER = 'openrouter';
    delete process.env.OPENROUTER_API_KEY;
    expect(buildVisionProvider()).toBeNull();
  });
});
