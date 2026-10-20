## Why

Each AI vendor currently needs its own provider class, API key, account and bill (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Trying a different model, or moving FB's deployment to another vendor, means getting new credentials and often writing new code. OpenRouter puts every major vendor behind one OpenAI-compatible API and one key, so changing the model becomes a config change.

## What Changes

- Add `OpenRouterExtractionProvider`, a vision provider that calls OpenRouter's OpenAI-compatible Chat Completions API and forces the existing `return_extracted_signal` tool call.
- Add `openrouter` as a value of `TRIDENT_AI_PROVIDER`, configured by `OPENROUTER_API_KEY` (required) and `OPENROUTER_MODEL` (optional, default `anthropic/claude-sonnet-4.6`).
- Share the extraction tool schema: export `SIGNAL_TOOL_SCHEMA` from `LangChainExtractionProvider.ts` so the new provider doesn't add a third hand-synced copy.
- Add OpenRouter model slugs to the `llmLogger` cost table so `LLM_CALL` entries keep reporting `estimatedCostUsd`.
- Make the promptfoo eval harness use `buildVisionProvider()` instead of a hard-coded Claude provider, so any provider or model can be scored against the golden dataset.
- Update the docs (`.env.example`, developer README, evals README, developer mental notes, analyst guide). This also fixes out-of-date references to `OPENAI_API_KEY` as the main key.
- No breaking changes: the default provider stays `anthropic`, and existing `.env` files behave the same.

## Capabilities

### New Capabilities
- `openrouter-extraction-provider`: selecting, configuring and calling OpenRouter as the screenshot-extraction vision provider, including cost logging and eval-harness provider selection.

### Modified Capabilities
<!-- None: openspec/specs/ has no archived specs yet, and existing provider behaviour is unchanged. -->

## Impact

- **Code:** `src/ai/providers/OpenRouterExtractionProvider.ts` (new), `src/ai/providers/index.ts`, `src/ai/providers/LangChainExtractionProvider.ts` (export only), `src/ai/llmLogger.ts`, `evals/provider.ts`.
- **Tests:** `tests/ai/openRouterProvider.test.ts` (new, with the `openai` SDK mocked).
- **Dependencies:** none new. Uses the existing `openai` SDK.
- **Config / env:** new `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`, plus a new `openrouter` value for `TRIDENT_AI_PROVIDER`.
- **Ops:** OpenRouter becomes an optional external dependency. `LLM_CALL` logs show `provider: "openrouter"` and the model slug.
