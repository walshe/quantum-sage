## Context

The app currently has one AI integration: `SignalExtractor.extract()` calls GPT-4o with analyst chart screenshots and returns a partial `ExtractionResult`. The existing `guardrail.ts` is a stub — both `checkBeforeCall` and `recordUsage` are no-ops. There is no logging of what was sent, what came back, how long it took, or what it cost. The analyst (FB) receives model output that has passed no structural or safety validation before it populates the form.

The Loki + Grafana stack is already running (from the observability layer). Winston JSON logging already ships to Loki. The task is to add a thin instrumentation wrapper around the existing AI call path without restructuring it.

## Goals / Non-Goals

**Goals:**
- Structured per-call audit log consumable via Grafana Logs Drilldown
- PII redaction in the audit trail (not in the inference path)
- Pre-send prompt injection screening for any text-derived inputs
- Post-response schema + range validation of `ExtractionResult`
- Per-session quality metrics as a single summary log entry
- Flesh out the existing `guardrail.ts` stub with real logic

**Non-Goals:**
- Real-time alerting on quality degradation (Grafana alerts can be wired up by the operator later using the log data)
- PII scrubbing of image bytes — images are never persisted or logged as text
- Full content moderation / toxicity scoring — out of scope for a trading tool
- Langfuse integration — evaluated and deferred (see Decisions §1)
- Rate limiting or per-user budget caps — stub shape exists; implementation deferred to Phase 2 when multi-user scenarios apply

## Decisions

### 1. Loki over Langfuse

Langfuse is a purpose-built LLM observability platform with a JavaScript SDK, free cloud tier (limited), and self-hostable option. It would give a dedicated UI for trace/span views and prompt comparison.

**Decision: defer Langfuse, use the existing Loki stack.**

Rationale:
- We already have Loki + Grafana running and shipping JSON logs. Adding Langfuse means a second observability system to operate, configure, and potentially pay for.
- At current scale (one AI call per analyst session, occasional), the data volume doesn't justify a dedicated platform.
- All the data Langfuse would capture (prompt, response, latency, cost, success/failure) can be expressed as a single structured JSON log entry and queried in Grafana Logs Drilldown.
- The decision is reversible: if usage grows and dedicated LLM tooling becomes worth it, the instrumentation wrapper already collects the right fields and can forward to Langfuse by adding an exporter.

### 2. Single instrumentation point: `SignalExtractor.extract()`

Two options: wrap each `VisionProvider` implementation, or wrap `SignalExtractor.extract()`.

**Decision: wrap `SignalExtractor.extract()`.**

Rationale: the extractor is the single public surface used by `server.ts`. Provider implementations are swappable internals. Instrumenting at the extractor level gives one code path to maintain regardless of how many providers exist, and keeps provider classes free of cross-cutting concerns — consistent with the project's interface-only architecture.

### 3. Regex-only PII redaction, no ML classifier

Options: regex patterns, a local NER model, or a cloud PII API.

**Decision: regex patterns only.**

Rationale: the logged content is structured extraction output from a financial chart — it contains numbers, level names, and timestamps, not free-form personal text. The realistic PII exposure is incidental (e.g., a filename that contains a name). A small set of regex patterns (email, phone, IBAN/account-style numbers) is sufficient, adds zero latency, and requires no new dependencies.

### 4. Output validation: TypeScript type guards + range checks, no JSON Schema library

**Decision: hand-written type guards + the same range checks the signal validator already uses.**

Rationale: `ExtractionResult` is a known internal type. Adding a JSON Schema library (`zod`, `ajv`) for one type is over-engineering. The extraction prompt already constrains the model to return nulls for unknown fields — validation just needs to confirm the shape and that numeric fields are in plausible ranges (prices within 20% of a reference, DVS 0–200, etc.).

### 5. Cost rate table is keyed by model ID and ships with DeepSeek rates from day one

A DeepSeek provider is planned as a cheaper alternative to GPT-4o. The rate table must therefore support multiple providers out of the box rather than being GPT-4o-only.

**Decision: rate table keyed by model ID (string), provider-agnostic.**

Each entry: `{ inputPer1MTokens: number, outputPer1MTokens: number }`. Initial entries:

| Model ID | Input ($/1M) | Output ($/1M) |
|---|---|---|
| `gpt-4o-2024-11-20` | $2.50 | $10.00 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| `deepseek-chat` (DeepSeek-V3) | $0.27 | $1.10 |
| `deepseek-reasoner` (DeepSeek-R1) | $0.55 | $2.19 |

Model IDs that do not appear in the table produce `estimatedCostUsd: null` with a warning — operators will notice and add the rate rather than silently getting zero cost data.

### 6. Quality metrics are log-only — no `/ai/stats` endpoint in Phase 1

Options: emit metrics as a structured log entry on shutdown, or expose them via a `/ai/stats` HTTP endpoint.

**Decision: log-only. Accumulate per-call stats in `SignalExtractor` and emit a single `AI_SESSION_METRICS` log entry on shutdown (SIGINT/SIGTERM) or via `SignalExtractor.flushMetrics()`.**

Rationale: Grafana Logs Drilldown can query `{service="trident"} | json | event = "AI_SESSION_METRICS"` and extract all numeric fields for dashboarding — no extra HTTP surface needed. Adding an endpoint introduces a new route, authentication considerations, and client tooling for something Grafana already handles. If a pull-based metrics API becomes necessary later, it can be added as a thin wrapper over `guardrail.getMetrics()` without changing the log structure.

This keeps metrics in the same log stream as everything else and avoids a separate metrics sink.

## Risks / Trade-offs

- **Regex PII redaction has false negatives** → acceptable for the current use case; the model input is chart images (not free text), so PII in prompts is unlikely. The system prompt and schema are static and contain no PII.
- **Injection screening may produce false positives on legitimate chart annotations** → screener only blocks on high-confidence patterns (e.g., `ignore previous instructions`); unusual level names won't trigger it.
- **Output validation adds a failure mode** → if the model returns a valid but unexpected shape (e.g., a field typed as string contains a number), the call fails rather than silently passing bad data. This is the desired behaviour — the analyst sees a clear error rather than a subtly wrong form pre-fill.
- **Cost estimation is approximate** → token counts come from the API response (`usage` field); USD cost is calculated from published per-token rates hardcoded per model. Rates change; the estimate is directionally correct, not billing-accurate.

## Migration Plan

1. All changes are additive and internal to `src/ai/`. No API surface changes.
2. The guardrail stub is replaced in-place — `checkBeforeCall` gains a return type (`{ allowed: boolean; reason?: string }`); callers already check the result shape (it was a no-op before).
3. No config changes required; no new env vars. Cost-rate constants are in code.
4. Rollback: revert `src/ai/` changes; no database or schema migrations to undo.

## Open Questions

None — all open questions resolved before implementation.
