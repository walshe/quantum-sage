## Why

The app already uses an AI vision model (GPT-4o) to extract signal data from analyst screenshots, but there is zero visibility into what it costs, how long it takes, whether it's hallucinating, or whether adversarial inputs could manipulate its output. As usage grows and more AI features are added, we need structured measurement before problems reach the analyst (FB).

## What Changes

- Every LLM call is wrapped by an instrumentation layer that records prompt, response, latency, token counts, and estimated cost to a structured log entry and the existing Loki stack
- Prompt inputs are screened for injection patterns before being sent to the provider; suspicious content is flagged and blocked
- Responses are validated against the expected `ExtractionResult` schema; out-of-format or obviously hallucinated outputs are rejected rather than silently passed to the analyst
- PII patterns (names, emails, phone numbers, account numbers) are redacted from logged prompt/response content so audit logs are safe to retain and inspect
- A lightweight quality-metrics summary (success rate, mean latency, mean cost, schema-validation failure rate) is computed per session and emitted to the structured log so Grafana dashboards can surface regression over time

## Capabilities

### New Capabilities

- `llm-call-logging`: Structured per-call audit log — prompt (PII-redacted), response (PII-redacted), latency ms, token counts (prompt/completion), estimated USD cost, provider, model, success/failure
- `prompt-injection-defence`: Pre-send screening of image-derived text and any user-supplied strings for prompt injection patterns; blocked calls are logged with reason
- `pii-redaction`: Regex + pattern-based redaction applied to logged prompt and response content before writing to Loki; original content never persisted
- `output-validation`: Post-response schema validation of `ExtractionResult`; rejects responses that fail shape checks or contain disallowed content (e.g. invented field values that violate known constraints)
- `ai-quality-metrics`: Per-session aggregated metrics (call count, success rate, p50/p95 latency, total cost, validation failure rate) emitted as a structured log entry at session end

### Modified Capabilities

- `ai-guardrail`: The existing stub guardrail (`guardrail.ts`) will be fleshed out — `checkBeforeCall` gains injection screening; `recordUsage` gains cost tracking and metric accumulation

## Impact

- `src/ai/guardrail.ts` — implement `checkBeforeCall` and `recordUsage` with real logic
- `src/ai/signalExtractor.ts` — wire output validation post-response
- New `src/ai/llmLogger.ts` — structured call logging with PII redaction
- New `src/ai/piiRedactor.ts` — redaction utility
- New `src/ai/outputValidator.ts` — schema + safety validation for `ExtractionResult`
- No changes to the web server, engine, or notifier chain
- No new dependencies required (patterns/regex only; Langfuse evaluated and deferred — see design.md)
