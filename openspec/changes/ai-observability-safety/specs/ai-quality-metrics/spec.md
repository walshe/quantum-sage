## ADDED Requirements

### Requirement: Per-session AI quality metrics are accumulated and emitted on shutdown
The system SHALL accumulate per-call statistics across the lifetime of the `SignalExtractor` instance and emit a single summary log entry with `event: "AI_SESSION_METRICS"` when the process shuts down (SIGINT/SIGTERM) or when `SignalExtractor.flushMetrics()` is called explicitly.

The summary SHALL include:
- `totalCalls`: total number of `extract()` invocations
- `successCount`: calls that returned a valid result
- `failureCount`: calls that threw (provider error or validation failure)
- `validationFailures`: calls that failed specifically due to output validation
- `injectionBlocks`: calls blocked by the injection screener
- `p50LatencyMs` and `p95LatencyMs`: latency percentiles across successful calls
- `totalCostUsd`: sum of `estimatedCostUsd` across all calls where it was non-null
- `successRate`: `successCount / totalCalls` as a decimal (0–1)

#### Scenario: Session summary is emitted on clean shutdown
- **WHEN** the process receives SIGINT or SIGTERM after one or more `extract()` calls
- **THEN** a log entry with `event: "AI_SESSION_METRICS"` containing all required fields is written before the process exits

#### Scenario: Zero-call session emits a summary with zeroed fields
- **WHEN** the process shuts down without any `extract()` calls having been made
- **THEN** `event: "AI_SESSION_METRICS"` is still emitted with all counts at zero and `p50LatencyMs: null`, `p95LatencyMs: null`

### Requirement: Metrics are queryable in Grafana via the Loki structured log
Because `AI_SESSION_METRICS` is emitted as a JSON log line via Winston, operators SHALL be able to query it in Grafana Logs Drilldown using:
```
{service="trident"} | json | event = "AI_SESSION_METRICS"
```
and extract numeric fields for dashboarding.

#### Scenario: All metric fields are present as top-level JSON keys
- **WHEN** the summary log entry is written
- **THEN** all metric fields appear as top-level keys in the JSON log line (not nested), making them directly extractable by Loki's `| json` parser
