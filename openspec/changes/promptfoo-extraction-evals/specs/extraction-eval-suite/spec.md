## ADDED Requirements

### Requirement: Eval suite runs via npm script
The system SHALL provide an `npm run eval` script in `trident/impl/nodejs/package.json` that executes the full promptfoo evaluation suite without requiring any arguments.

#### Scenario: Developer runs eval suite
- **WHEN** a developer runs `npm run eval` from `trident/impl/nodejs/`
- **THEN** promptfoo runs all test cases in the golden dataset and prints pass/fail results to the terminal

#### Scenario: Missing API key
- **WHEN** `OPENAI_API_KEY` is not set and the developer runs `npm run eval`
- **THEN** the run fails with a clear error message before making any API calls

---

### Requirement: Custom provider calls the production extraction pipeline
The eval suite SHALL use a custom promptfoo provider that invokes `SignalExtractor.extract()` directly, including the guardrail, LangChain structured output, and output validation layers.

#### Scenario: Provider returns structured output
- **WHEN** promptfoo invokes the custom provider with a screenshot path from the dataset
- **THEN** the provider returns the full `ExtractionResult` JSON as the prompt output for assertion

#### Scenario: Provider blocked by guardrail
- **WHEN** a dataset entry contains an image that triggers the injection guardrail
- **THEN** the provider returns a response indicating the extraction was blocked, and the test case fails with reason `guardrail_blocked`

---

### Requirement: Golden dataset covers key extraction scenarios
The eval dataset SHALL include at least 3 IV Smile screenshot fixtures covering representative cases, each with labelled expected values.

#### Scenario: Standard single-column IV Smile chart
- **WHEN** the dataset fixture is a standard single-column IV Smile chart
- **THEN** the test case asserts all four level fields (`max_buy_1`, `max_buy_2`, `max_sell_1`, `max_sell_2`), `volatility.dvs`, and `volatility.regime`

#### Scenario: Two-column IV Smile chart (morning + afternoon)
- **WHEN** the dataset fixture is a two-column IV Smile chart
- **THEN** the test case asserts that left-column DVS values are used (not right-column) and all four levels are extracted from the correct column

---

### Requirement: Level price assertions use tolerance bounds
Numeric level price assertions (futures points) SHALL use a tolerance of ±5 points to account for OCR variance across chart renders.

#### Scenario: Level within tolerance passes
- **WHEN** the extracted `max_buy_1` is within ±5 of the expected value in `dataset.yaml`
- **THEN** the assertion passes

#### Scenario: Level outside tolerance fails
- **WHEN** the extracted `max_buy_1` differs from the expected value by more than 5 points
- **THEN** the assertion fails and the actual vs expected values are shown in the output

---

### Requirement: DVS assertion uses tight tolerance
The `volatility.dvs` assertion SHALL use a tolerance of ±1 (DVS is a single decimal value read directly from a labeled box, not inferred from a range panel).

#### Scenario: DVS within tolerance passes
- **WHEN** the extracted `volatility.dvs` is within ±1 of the expected value
- **THEN** the assertion passes

---

### Requirement: Regime assertion is exact
The `volatility.regime` assertion SHALL be an exact string match (`compressed` / `normal` / `elevated` / `extreme`).

#### Scenario: Correct regime passes
- **WHEN** the extracted `volatility.regime` matches the expected value exactly
- **THEN** the assertion passes

#### Scenario: Wrong regime fails
- **WHEN** the extracted `volatility.regime` does not match the expected value
- **THEN** the assertion fails and both values are shown

---

### Requirement: Null fields for cash_last and basis are expected
The eval suite SHALL NOT assert on `meta.cash_last` or `meta.basis` — these are intentionally left null by the extraction prompt.

#### Scenario: Null cash_last does not fail the test case
- **WHEN** the extraction returns `meta.cash_last: null`
- **THEN** no assertion fires for that field and the test case result is unaffected
