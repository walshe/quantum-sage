## ADDED Requirements

### Requirement: OpenRouter provider selection
The system SHALL support `TRIDENT_AI_PROVIDER=openrouter`, which selects an OpenRouter-backed vision provider configured by `OPENROUTER_API_KEY` and an optional `OPENROUTER_MODEL`. The default provider SHALL remain `anthropic` when `TRIDENT_AI_PROVIDER` is unset.

#### Scenario: OpenRouter selected with a key
- **WHEN** `TRIDENT_AI_PROVIDER=openrouter` and `OPENROUTER_API_KEY` is set
- **THEN** `buildVisionProvider()` returns a provider whose `name` is `openrouter`

#### Scenario: Custom model slug
- **WHEN** `OPENROUTER_MODEL` is set (e.g. `google/gemini-2.5-pro`)
- **THEN** the provider's `model` equals that slug and every request uses it

#### Scenario: Default model
- **WHEN** `OPENROUTER_MODEL` is unset
- **THEN** the provider uses `anthropic/claude-sonnet-4.6`

#### Scenario: OpenRouter selected without a key
- **WHEN** `TRIDENT_AI_PROVIDER=openrouter` and `OPENROUTER_API_KEY` is missing
- **THEN** `buildVisionProvider()` logs an error and returns `null`, and engine startup is not blocked

#### Scenario: Default provider unchanged
- **WHEN** `TRIDENT_AI_PROVIDER` is unset
- **THEN** the Anthropic provider is selected exactly as before this change

### Requirement: OpenRouter request contract
The OpenRouter provider SHALL send requests to OpenRouter's OpenAI-compatible endpoint (`https://openrouter.ai/api/v1`). Each request SHALL include the system prompt, the screenshots as base64 data URLs, and a single `return_extracted_signal` tool (using the shared extraction schema) that the model is forced to call through `tool_choice`.

#### Scenario: Request shape
- **WHEN** `extractSignal(images, systemPrompt)` is called
- **THEN** the request targets the OpenRouter base URL, carries the system prompt as the system message and each image as a `data:<mime>;base64,` URL, and sets `tool_choice` to `return_extracted_signal`

#### Scenario: No images
- **WHEN** `extractSignal` is called with an empty image list
- **THEN** it throws before making any network call

### Requirement: Fallback for models without forced tool_choice
When a request fails with a 400 saying a forced `tool_choice` is not supported, the provider SHALL retry once with the same tool and `tool_choice: "auto"`, and SHALL use `"auto"` for later calls on the same provider instance (the app builds one instance per process at startup). Other errors SHALL NOT trigger the fallback.

#### Scenario: Model rejects forced tool_choice
- **WHEN** the first request returns 400 `tool_choice ... not supported for this model`
- **THEN** the provider retries with `tool_choice: "auto"` and returns the parsed tool call

#### Scenario: Fallback is remembered
- **WHEN** a later extraction runs on the same provider instance
- **THEN** it is sent with `tool_choice: "auto"` straight away

#### Scenario: Concurrent calls
- **WHEN** several calls are in flight and all fail in forced mode
- **THEN** each of them retries with `tool_choice: "auto"`

#### Scenario: Unrelated error
- **WHEN** a request fails with any other error (e.g. a 400 about the image)
- **THEN** the error is re-thrown without a retry

#### Scenario: Prose reply after fallback
- **WHEN** the model answers in prose under `tool_choice: "auto"`
- **THEN** the provider throws the missing-tool-call error

### Requirement: OpenRouter response handling
The provider SHALL turn the forced tool call's JSON arguments into an `ExtractionResult` with `provider: "openrouter"`, the model slug, and token usage when reported. It SHALL throw a descriptive error when the response has no matching tool call, the arguments are not valid JSON, or the `signal` field is missing, so the existing extractor error path and output validator apply.

#### Scenario: Successful tool call
- **WHEN** the response contains a `return_extracted_signal` tool call with valid JSON arguments
- **THEN** the result carries the parsed `signal`, `notes`, `warnings`, `provider: "openrouter"`, and `usage` mapped from `prompt_tokens`/`completion_tokens`

#### Scenario: Prose reply instead of a tool call
- **WHEN** the model replies with text and no tool call
- **THEN** the provider throws an error naming the missing tool call and the `finish_reason`

#### Scenario: Malformed arguments
- **WHEN** the tool call arguments are not valid JSON
- **THEN** the provider throws an error saying the arguments are not valid JSON

### Requirement: Cost logging for OpenRouter models
The LLM call logger SHALL include cost rates for the supported OpenRouter model slugs, so `LLM_CALL` entries report `estimatedCostUsd` for those models.

#### Scenario: Known slug
- **WHEN** an extraction completes with model `anthropic/claude-sonnet-4.6`
- **THEN** the `LLM_CALL` entry has a non-null `estimatedCostUsd` computed from that slug's rates

#### Scenario: Unknown slug
- **WHEN** an extraction completes with a slug missing from the cost table
- **THEN** the logger warns and records `estimatedCostUsd: null`, as for any unknown model

### Requirement: Eval harness follows provider selection
The promptfoo eval harness SHALL build its provider with `buildVisionProvider()`, so evals score the same provider and model the app would use under the current environment.

#### Scenario: Evaluate an OpenRouter model
- **WHEN** `TRIDENT_AI_PROVIDER=openrouter OPENROUTER_MODEL=<slug> npm run eval` is run with a valid key
- **THEN** every fixture is extracted through the OpenRouter provider using `<slug>`

#### Scenario: No provider configured
- **WHEN** the selected provider has no API key
- **THEN** the harness fails at startup with a message saying to set that provider's key
