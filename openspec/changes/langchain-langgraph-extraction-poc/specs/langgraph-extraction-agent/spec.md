## ADDED Requirements

### Requirement: Extraction pipeline modelled as a LangGraph StateGraph
`SignalExtractor.extract()` SHALL delegate its pipeline to a compiled LangGraph `StateGraph` with four nodes: `guardrail`, `llm-call`, `validate`, `normalise`. The graph SHALL be compiled once at construction time and reused across calls.

#### Scenario: Happy path — all nodes succeed
- **WHEN** a valid image is submitted with a clean caller key
- **THEN** the graph executes all four nodes in order and returns a normalised `ExtractionResult`

### Requirement: Guardrail node gates the pipeline
The `guardrail` node SHALL call `checkBeforeCall()` from `guardrail.ts`. If the decision is `allowed: false`, the node SHALL set `state.blocked = true` and the graph SHALL route to an end node that throws `ExtractionBlockedError`.

#### Scenario: Injection pattern detected
- **WHEN** the caller key contains a known injection phrase (e.g. "ignore previous instructions")
- **THEN** the guardrail node sets `blocked: true`, the graph short-circuits, and `ExtractionBlockedError` is thrown before any LLM call is made

### Requirement: LLM-call node invokes the provider
The `llm-call` node SHALL call `provider.extractSignal(state.images, systemPrompt)` and store the result in `state.result`. On provider error, it SHALL set `state.error` and the graph SHALL route to an end node that logs the failure and re-throws.

#### Scenario: Provider API call succeeds
- **WHEN** the provider returns a valid `ExtractionResult`
- **THEN** `state.result` is populated and the graph proceeds to the validate node

#### Scenario: Provider API call fails (e.g. timeout)
- **WHEN** `provider.extractSignal` throws
- **THEN** `state.error` is set, logging and metrics are recorded, and the error propagates to the caller

### Requirement: Validate node runs output validation
The `validate` node SHALL call `validateExtractionResult()` from `outputValidator.ts` on `state.result`. On `OutputValidationError`, it SHALL set `state.error` and route to the error end node.

#### Scenario: Model returns out-of-range DVS value
- **WHEN** the model returns `dvs: 999` (outside the 0–200 range)
- **THEN** the validate node catches `OutputValidationError`, sets `state.error`, and the graph routes to the error path

### Requirement: Normalise node stamps server-controlled fields
The `normalise` node SHALL apply the `normalise()` function (schema_version, execution_instrument, update_seq default, levels.additional default, vwap.source default) and store the result back in `state.result`.

#### Scenario: Model omits update_seq
- **WHEN** the model response has no `update_seq` field
- **THEN** the normalise node sets `update_seq: 1` before returning

### Requirement: Each node is independently unit-testable
Each graph node function SHALL be exported from its module and testable in isolation by calling it directly with a constructed `ExtractionState` object, without invoking the full compiled graph.

#### Scenario: Guardrail node unit test
- **WHEN** `guardrailNode({ images: [...], callerKey: 'safe-key', t0: Date.now() })` is called directly
- **THEN** it returns a state with `blocked: false` and no `error`

### Requirement: Logging and metrics remain in SignalExtractor
`SignalExtractor.extract()` SHALL record `logLlmCall()`, `recordUsage()`, and the completion log after the graph resolves or rejects. These calls SHALL NOT be inside graph nodes.

#### Scenario: Graph completes successfully
- **WHEN** `graph.invoke(initialState)` resolves
- **THEN** `SignalExtractor` calls `logLlmCall` with `success: true` and `recordUsage` with the token counts from `state.result.usage`

#### Scenario: Graph rejects with an error
- **WHEN** `graph.invoke(initialState)` rejects
- **THEN** `SignalExtractor` calls `logLlmCall` with `success: false` and re-throws the original error
