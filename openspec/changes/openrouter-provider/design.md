## Context

The AI extraction pipeline (`src/ai/`) runs one LangGraph state graph (guardrail → llm-call → validate → normalise) and hosts a pluggable `VisionProvider`. `buildVisionProvider()` chooses the provider from `TRIDENT_AI_PROVIDER`:

- `anthropic` (default): `ClaudeExtractionProvider`, which calls the Anthropic SDK directly with a forced tool call and prompt caching.
- `openai`: `LangChainExtractionProvider`, which uses `ChatOpenAI` with `.withStructuredOutput()`.

Each provider ties Trident to one vendor's key and bill. The eval harness was hard-coded to `ClaudeExtractionProvider`, so comparing models meant editing code.

## Goals / Non-Goals

**Goals:**
- One key (`OPENROUTER_API_KEY`) gives access to Anthropic, OpenAI, Google and other vision models.
- Changing models takes only `OPENROUTER_MODEL`, with no code changes.
- Same contract as the existing providers: forced structured tool output, same schema, same `ExtractionResult`. Guardrail, validator and logging stay untouched.
- The eval suite can score any configured provider and model.

**Non-Goals:**
- Changing the default provider (stays `anthropic`).
- Removing the direct Anthropic or OpenAI providers. They remain available, and as a fallback if OpenRouter has problems.
- OpenRouter-specific routing features (fallback model lists, provider preferences, `usage.include` cost reporting).
- Explicit prompt caching through OpenRouter.

## Decisions

**1. Use the `openai` SDK with OpenRouter's base URL, not LangChain and not an OpenRouter SDK.**
OpenRouter implements the OpenAI Chat Completions protocol. The `openai` SDK is already a dependency, so there's no new package.
- *Rejected: reuse `LangChainExtractionProvider` with `OPENAI_BASE_URL`.* For non-`gpt-4` model names, `@langchain/openai` 0.4 makes `withStructuredOutput` default to `response_format: json_schema`, which OpenRouter doesn't support consistently across vendors. Its provider `name` is also hard-coded to `openai`, which would give misleading `LLM_CALL` logs.
- *Rejected: a dedicated OpenRouter SDK.* It would add a dependency for no extra capability.

**2. Use a forced tool call (`tool_choice: return_extracted_signal`) for structured output, and fall back to `tool_choice: "auto"` automatically.**
OpenRouter supports tool calling more widely across vendors than `json_schema` response formats, and it matches how the Claude provider already works. The arguments are parsed with `JSON.parse`. Malformed JSON, a missing tool call or a missing `signal` field all throw, so the `SignalExtractor` error path handles them, followed by the output validator.

Some models reject a forced `tool_choice`. Claude Sonnet 5.5 returns 400 `tool_choice: type "tool" and "any" are not supported for this model` from every endpoint. When a call fails with that specific error, the provider retries once with `tool_choice: "auto"` and keeps using that mode for the rest of that provider instance's life. The app builds one instance at startup, so in practice that means once per process. The memory is deliberately per instance, not module-level, so tests and separately built providers (e.g. the eval harness) stay independent. The prompt still demands the tool, and a prose reply still throws. The mode is captured per call, so parallel calls that all fail in forced mode each retry.
- *Rejected: fall back to `response_format: json_schema`.* Claude rejects our schema twice over. Nullable enums (`type: ['string','null']` with `enum`) are invalid, and even after rewriting them as `anyOf`, Claude caps structured-output schemas at 16 nullable/union parameters, while the signal schema has 29. Fitting under that limit would mean redesigning the shared extraction schema.
- *Rejected: switch every model to `auto`.* Forced mode guarantees a tool call wherever it's supported, so keep it as the default.

**3. Export one shared `SIGNAL_TOOL_SCHEMA`.**
The new provider imports the schema from `LangChainExtractionProvider.ts` instead of adding a third copy. The Claude provider keeps its own copy for now, so it is untouched. Merging all copies into one module can be a follow-up.

**4. Default model `anthropic/claude-sonnet-4.6`.**
Developer mental notes record that Claude Sonnet reads the two-column IV Smile panel correctly where GPT-4o does not. The OpenRouter default keeps the model already validated against the golden dataset.

**5. Missing key when `openrouter` is selected logs `error` and returns `null`.**
`openrouter` is never the implicit default, so selecting it without a key is always a misconfiguration. Returning `null` follows the existing "AI is optional, never block startup" rule.

**6. Eval harness uses `buildVisionProvider()`.**
Evals now run against exactly what the app would use, and `TRIDENT_AI_PROVIDER=openrouter OPENROUTER_MODEL=<slug> npm run eval` compares models with no code changes.

## Risks / Trade-offs

- [No explicit `cache_control` prompt caching through OpenRouter] → Cost is negligible at under one extraction a day (~2,500 tokens). The direct Anthropic provider is still available if call volume grows.
- [A model slug that is wrong or retired breaks extraction] → The default slug is verified with a live eval before merge. A bad slug surfaces as a provider error in the UI and in the `LLM_CALL` log, and the analyst can still fill the form manually.
- [A slug missing from `COST_RATES` logs `estimatedCostUsd: null`] → Existing behaviour already logs a warning. Add the slug to the table when adopting a new model.
- [OpenRouter outage or extra latency, since it's another hop] → Switch back to `TRIDENT_AI_PROVIDER=anthropic` with a direct key.
- [Some vendors behind OpenRouter may ignore `tool_choice` or `detail: 'high'`] → The provider throws if there's no tool call, and the eval suite catches accuracy drops before a model is adopted.
- [With `tool_choice: "auto"` the model could answer in prose] → The extraction fails with a clear error and the analyst fills the form manually. In live evals, Sonnet 5.5 called the tool 6 out of 6 times.
- [The first call per process to a model that needs the fallback makes one rejected request] → The 400 isn't billed and adds about 4 s, once per process.

## Migration Plan

Opt-in only. To switch, add `TRIDENT_AI_PROVIDER=openrouter` and `OPENROUTER_API_KEY` to `.env` and restart. To roll back, remove those lines or set `TRIDENT_AI_PROVIDER=anthropic`. No data or schema migration is needed.

## Open Questions

- Should OpenRouter become the default for FB's deployment once the live eval passes? That's a separate decision, made after the eval.
