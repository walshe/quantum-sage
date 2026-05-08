## ADDED Requirements

### Requirement: ExtractionResult is validated against schema before being returned to the caller
The system SHALL validate the parsed `ExtractionResult` from the model against the expected TypeScript shape and known value constraints after parsing but before returning to `server.ts`. If validation fails, `extract()` SHALL throw a structured error rather than returning an invalid result.

Shape checks the system SHALL enforce:
- `notes` and `warnings` are arrays of strings (or absent)
- Numeric fields (`dvs`, `vwap.value`, price levels) are numbers or null — never strings
- `schema_version` equals `"1.0"`
- `bias.direction` if present is one of `"long"`, `"short"`, `"neutral"`
- `bias.confidence` if present is one of `"low"`, `"medium"`, `"high"`
- `volatility.regime` if present is one of `"low"`, `"normal"`, `"elevated"`

#### Scenario: Well-formed model response passes validation
- **WHEN** the model returns a response that parses to a structurally valid `ExtractionResult`
- **THEN** `extract()` returns the result normally with no validation error

#### Scenario: Numeric field returned as string is rejected
- **WHEN** the model returns a price level as a string (e.g. `"6582"` instead of `6582`)
- **THEN** `extract()` throws with a validation error identifying the offending field; the caller receives a 502 response

#### Scenario: Invalid enum value is rejected
- **WHEN** the model returns `bias.direction: "bullish"` (not a valid enum value)
- **THEN** `extract()` throws with a validation error; the invalid result is never returned to the analyst

### Requirement: Validation failures are logged as structured entries
The system SHALL emit an `error`-level log entry with `event: "OUTPUT_VALIDATION_FAILED"` and the list of validation errors whenever a model response fails validation.

#### Scenario: Validation failure produces audit log entry
- **WHEN** `extract()` throws due to output validation failure
- **THEN** a log entry with `event: "OUTPUT_VALIDATION_FAILED"` and `errors: string[]` is written before the exception propagates

### Requirement: Range checks are applied to numeric fields where constraints are known
The system SHALL apply plausible range checks to numeric fields: `dvs` must be 0–200 if non-null; price levels must be positive if non-null. Out-of-range values are treated as validation failures.

#### Scenario: DVS value outside 0–200 is rejected
- **WHEN** the model returns `dvs: 350`
- **THEN** `extract()` throws with a validation error citing the out-of-range DVS value
