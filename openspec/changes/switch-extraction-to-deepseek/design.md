## Context

The extraction pipeline uses `LangChainExtractionProvider`, which wraps `ChatOpenAI` from `@langchain/openai`. It already accepts `apiKey`, `model`, and `baseURL` constructor options, meaning any OpenAI-compatible API can be used without touching the provider class itself. The `buildVisionProvider()` factory in `src/ai/providers/index.ts` is the sole place that decides which provider to instantiate.

DeepSeek V4 (`deepseek-chat`) exposes an OpenAI-compatible API at `https://api.deepseek.com/v1` and supports vision (image_url messages). The switch is therefore a factory change, not a provider rewrite.

## Goals / Non-Goals

**Goals:**
- `TRIDENT_AI_PROVIDER=deepseek` selects DeepSeek V4 for extraction
- `DEEPSEEK_API_KEY` is the credential; `DEEPSEEK_MODEL` and `DEEPSEEK_BASE_URL` allow overrides
- The `LangChainExtractionProvider` class is reused unchanged
- Both `openai` and `deepseek` remain valid choices so operators can switch back easily
- The `provider.name` field in extraction results reflects the active provider

**Non-Goals:**
- Removing OpenAI support
- Changing the extraction prompt, schema, or graph logic
- Adding a new provider class

## Decisions

**Decision: Reuse `LangChainExtractionProvider` with DeepSeek opts**
DeepSeek's API is OpenAI-compatible; `ChatOpenAI` with a custom `baseURL` and `apiKey` works without modification. Alternatives (a new `DeepSeekProvider` class, `@langchain/deepseek` package) add complexity for no benefit.

**Decision: Make `provider.name` dynamic**
`LangChainExtractionProvider` currently hardcodes `name = 'openai'`. Change it to accept a `name` option so the factory can pass `'deepseek'` when that provider is selected. This keeps logs and metrics accurate without a separate class.

**Decision: Default stays `openai`**
Operators who don't set `TRIDENT_AI_PROVIDER` keep the current behaviour. DeepSeek is opt-in. This avoids surprising anyone running with an existing `.env`.

**Decision: Env var naming mirrors OpenAI pattern**
`DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL` — consistent with `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`. Easy to understand and swap.

## Risks / Trade-offs

[Vision quality difference] → DeepSeek V4 vision may extract chart values less accurately than GPT-4o on some screenshots. → Mitigation: run the promptfoo eval suite against both models before committing to DeepSeek in production.

[API availability / rate limits] → DeepSeek API may have different rate limits or occasional outages. → Mitigation: extraction failures are already handled gracefully (non-fatal, analyst falls back to manual entry).

[Model name changes] → DeepSeek may retire `deepseek-chat` in favour of a new identifier. → Mitigation: `DEEPSEEK_MODEL` env var allows overriding without a code change.

## Status Note (2026-05-25)

DeepSeek V4 multimodal (vision in the standard chat API) is in grey-box testing as of April 2026 and expected imminently. The current `deepseek-chat` endpoint rejects `image_url` messages — this branch is parked until V4 launches and the API accepts image content. Code is complete; activation requires only setting `TRIDENT_AI_PROVIDER=deepseek` and `DEEPSEEK_API_KEY` in `.env`.

## Migration Plan

1. Update `LangChainExtractionProviderOpts` to accept optional `name` field
2. Add `deepseek` case to `buildVisionProvider()` using `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` (default `deepseek-chat`), `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com/v1`)
3. Update README and RUNNING.md with new env vars
4. Rollback: set `TRIDENT_AI_PROVIDER=openai` and `OPENAI_API_KEY` — no code change needed
