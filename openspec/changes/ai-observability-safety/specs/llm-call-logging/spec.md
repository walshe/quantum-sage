## ADDED Requirements

### Requirement: Every LLM call produces a structured audit log entry
The system SHALL emit one structured JSON log entry per LLM call via the existing Winston logger, written at `info` level with `module: "LLMLogger"`. The entry SHALL be written after the call completes (success or failure) and SHALL include: `event: "LLM_CALL"`, `provider`, `model`, `latencyMs`, `promptTokens`, `completionTokens`, `totalTokens`, `estimatedCostUsd`, `success` (boolean), `error` (string or null), and `callerKey`.

#### Scenario: Successful call is logged with full metrics
- **WHEN** `SignalExtractor.extract()` completes successfully
- **THEN** a log entry is emitted containing `event: "LLM_CALL"`, `success: true`, numeric `latencyMs`, token counts from the API response `usage` field, and a non-null `estimatedCostUsd`

#### Scenario: Failed call is logged with error
- **WHEN** `SignalExtractor.extract()` throws or the provider returns an error
- **THEN** a log entry is emitted containing `event: "LLM_CALL"`, `success: false`, the error message in the `error` field, and `latencyMs` reflecting time until failure

#### Scenario: Log entry never contains raw prompt or response text
- **WHEN** any LLM call completes
- **THEN** the log entry SHALL NOT include the raw `messages` array or the raw model response text; only metadata fields are logged (prompts and responses are handled separately by the PII-redaction capability if text logging is enabled in future)

### Requirement: Cost is estimated from token counts and published model rates
The system SHALL compute `estimatedCostUsd` as `(promptTokens × inputRate + completionTokens × outputRate)` using a hardcoded rate table keyed by model ID. The system SHALL log a warning if the model ID is not in the rate table and SHALL set `estimatedCostUsd: null` in that case.

#### Scenario: Known model produces cost estimate
- **WHEN** the provider returns `usage` for a model present in the rate table (e.g. `gpt-4o-2024-11-20`)
- **THEN** `estimatedCostUsd` is a positive number reflecting the computed cost

#### Scenario: Unknown model produces null cost with warning
- **WHEN** the provider returns a model ID not present in the rate table
- **THEN** `estimatedCostUsd` is `null` and a `warn`-level log entry is emitted identifying the unknown model
