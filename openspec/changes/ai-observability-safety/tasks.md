## 1. PII Redaction Utility

- [ ] 1.1 Create `src/ai/piiRedactor.ts` — pure `piiRedact(text: string): string` function with regex patterns for email, phone, IBAN, and 10–19 digit account numbers
- [ ] 1.2 Write unit tests covering: email redacted, phone redacted, IBAN redacted, trading prices NOT redacted, same input produces same output

## 2. Guardrail — Injection Screening

- [ ] 2.1 Update `checkBeforeCall` in `src/ai/guardrail.ts` to return `{ allowed: boolean; reason?: string }` instead of void
- [ ] 2.2 Implement injection pattern list (multi-word phrases: `ignore previous instructions`, `disregard your system prompt`, `you are now`, `forget everything`, `act as`) and screen any text inputs passed to `checkBeforeCall`
- [ ] 2.3 Emit `warn` log entry with `event: "INJECTION_BLOCKED"` and pattern category when a call is blocked
- [ ] 2.4 Write unit tests: clean input passes, injection phrase blocks, partial word match ("ignore outliers") does not block

## 3. Guardrail — Usage Accumulation

- [ ] 3.1 Add session stats store to guardrail: `totalCalls`, `successCount`, `failureCount`, `validationFailures`, `injectionBlocks`, `latencySamples[]`, `totalCostUsd`
- [ ] 3.2 Implement `recordUsage({ latencyMs, promptTokens, completionTokens, estimatedCostUsd, success, validationFailed })` to accumulate into the store
- [ ] 3.3 Expose `getMetrics()` on the guardrail that computes and returns the full `AI_SESSION_METRICS` shape (p50/p95 computed from `latencySamples`)
- [ ] 3.4 Write unit tests: success increments correct counters, failure does not add to cost, p50/p95 computed correctly for known sample sets

## 4. LLM Call Logger

- [ ] 4.1 Create `src/ai/llmLogger.ts` — `logLlmCall(entry: LlmCallEntry): void` that emits a structured `info` log with `event: "LLM_CALL"` via Winston
- [ ] 4.2 Define `LlmCallEntry` type: `{ provider, model, latencyMs, promptTokens, completionTokens, totalTokens, estimatedCostUsd, success, error, callerKey }`
- [ ] 4.3 Implement cost rate table (hardcoded, keyed by model ID) and `estimateCost(model, promptTokens, completionTokens): number | null`; emit `warn` for unknown models
- [ ] 4.4 Write unit tests: known model produces cost, unknown model returns null with warn, log entry never contains raw prompt/response text

## 5. Output Validator

- [ ] 5.1 Create `src/ai/outputValidator.ts` — `validateExtractionResult(result: unknown): ExtractionResult` that applies shape and enum checks, throws with error list on failure
- [ ] 5.2 Implement checks: numeric fields not strings, `schema_version === "1.0"`, `bias.direction` enum, `bias.confidence` enum, `volatility.regime` enum, `dvs` in 0–200, price levels positive if non-null
- [ ] 5.3 Emit `error` log entry with `event: "OUTPUT_VALIDATION_FAILED"` and `errors: string[]` before throwing
- [ ] 5.4 Write unit tests: valid result passes, string-typed number rejected, invalid enum rejected, DVS 350 rejected, null fields pass (nullable fields are allowed)

## 6. Wire Everything into SignalExtractor

- [ ] 6.1 In `SignalExtractor.extract()`, call `guardrail.checkBeforeCall(context)` and throw / return 400 if `allowed: false`
- [ ] 6.2 Record `startTime = Date.now()` before the provider call; compute `latencyMs` after
- [ ] 6.3 Call `validateExtractionResult()` on the parsed response before returning; catch validation errors and rethrow as structured errors
- [ ] 6.4 Call `logLlmCall()` with the full entry (including `estimatedCostUsd`) after each call (success or failure)
- [ ] 6.5 Call `guardrail.recordUsage()` with the accumulated stats after each call
- [ ] 6.6 Add `flushMetrics(): void` method to `SignalExtractor` that emits `event: "AI_SESSION_METRICS"` log entry via `guardrail.getMetrics()`

## 7. Session Shutdown Hook

- [ ] 7.1 In `src/index.ts` shutdown handler, call `extractor.flushMetrics()` if an extractor instance exists before closing the web server
- [ ] 7.2 Verify the summary log entry appears in Grafana Logs Drilldown under `event = "AI_SESSION_METRICS"` after a clean shutdown

## 8. Tests and Verification

- [ ] 8.1 Add integration test in `tests/aiSafety.test.ts` covering the full path: injected input blocked, valid input succeeds with structured log entry, invalid model output rejected
- [ ] 8.2 Run full test suite (`npm test`) — all existing tests must remain green
- [ ] 8.3 Update `developer-mental-notes.md` with the AI safety layer section (injection screener, output validator, metrics flush on shutdown)
