## 1. Provider implementation

- [x] 1.1 Export `SIGNAL_TOOL_SCHEMA` from `src/ai/providers/LangChainExtractionProvider.ts`
- [x] 1.2 Create `src/ai/providers/OpenRouterExtractionProvider.ts` (`openai` SDK, OpenRouter base URL, forced `return_extracted_signal` tool, default model `anthropic/claude-sonnet-4.6`)
- [x] 1.3 Add the `openrouter` case to `buildVisionProvider()` in `src/ai/providers/index.ts` (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`; a missing key logs an error and returns `null`)
- [x] 1.4 Add OpenRouter slugs to `COST_RATES` in `src/ai/llmLogger.ts`

## 2. Evals

- [x] 2.1 Make `evals/provider.ts` use `buildVisionProvider()` instead of a hard-coded `ClaudeExtractionProvider`

## 3. Tests

- [x] 3.1 Add `tests/ai/openRouterProvider.test.ts` covering client config, request shape, response parsing, prose reply, malformed JSON, empty images, and provider selection (8 tests, `openai` SDK mocked)
- [x] 3.2 `npx tsc --noEmit` clean and `npm test` green (202/202)

## 4. Documentation

- [x] 4.1 `.env.example`: document `TRIDENT_AI_PROVIDER` values, `ANTHROPIC_*`, `OPENROUTER_*`, and fix the out-of-date "default openai" comment
- [x] 4.2 Developer README: env table and eval section
- [x] 4.3 `evals/README.md`: provider selection instead of the out-of-date `OPENAI_API_KEY` requirement
- [x] 4.4 Developer mental notes: OpenRouter provider rationale and trade-offs, cost-table note
- [x] 4.5 Analyst guide: OpenRouter option in step 5b, provider-neutral wording for Import

## 5. Live verification

- [x] 5.1 Check on openrouter.ai/models that the default slug `anthropic/claude-sonnet-4.6` (and the slugs in `COST_RATES`) exist
- [x] 5.2 Run `TRIDENT_AI_PROVIDER=openrouter npm run eval` with a real `OPENROUTER_API_KEY` and confirm the golden-dataset fixtures pass with the same results as the direct Anthropic provider
- [x] 5.3 Smoke test in the dashboard: Import from screenshot with `TRIDENT_AI_PROVIDER=openrouter`, then check the form pre-fills and an `LLM_CALL` log has `provider: "openrouter"` and a non-null cost

## 6. Forced tool_choice fallback (Claude Sonnet 5.5)

- [x] 6.1 Fall back to `tool_choice: "auto"` on the "forced tool_choice not supported" 400, remember it per provider instance, and capture the mode per call so parallel calls each retry
- [x] 6.2 Tests: fallback, remembered mode, concurrent calls, unrelated 400 not retried, prose after fallback (13 provider tests; suite 207/207)
- [x] 6.3 Add `anthropic/claude-sonnet-5.5` and `anthropic/claude-haiku-5.5` to `COST_RATES`
- [x] 6.4 Live eval: Sonnet 5.5 passes 3/3 in two runs (fallback used), Sonnet 4.6 still 3/3 on forced mode
- [x] 6.5 Update design.md (decision 2, risks), the spec, and the developer mental notes
