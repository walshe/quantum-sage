## Why

The extraction pipeline currently requires `OPENAI_API_KEY` and calls GPT-4o for every screenshot import. DeepSeek V4 (`deepseek-chat`) supports vision/image inputs via an OpenAI-compatible API and costs roughly 10x less ($0.27/M vs ~$2.50/M input tokens). The existing `LangChainExtractionProvider` already accepts a custom `baseURL`, so the switch is largely configuration rather than new code.

## What Changes

- Add `deepseek` as a selectable option for `TRIDENT_AI_PROVIDER`
- Add `DEEPSEEK_API_KEY` env var; use DeepSeek's base URL (`https://api.deepseek.com/v1`) and model (`deepseek-chat`) when selected
- Wire the new case into `src/ai/providers/index.ts` — reuse `LangChainExtractionProvider` with DeepSeek opts
- Update `provider.name` field to reflect the active provider
- Update `README.md` and `RUNNING.md` env var documentation

## Capabilities

### New Capabilities

- `deepseek-extraction-provider`: AI extraction configurable via `TRIDENT_AI_PROVIDER=deepseek` using DeepSeek V4 vision at ~10x lower cost than GPT-4o

### Modified Capabilities

## Impact

- `src/ai/providers/index.ts` — add `deepseek` case to `buildVisionProvider()`
- `src/ai/providers/LangChainExtractionProvider.ts` — minor: `name` field should reflect chosen provider
- `.env` — `DEEPSEEK_API_KEY`, optionally `DEEPSEEK_MODEL` and `DEEPSEEK_BASE_URL`
- `trident/impl/nodejs/README.md`, `RUNNING.md` — env var documentation
