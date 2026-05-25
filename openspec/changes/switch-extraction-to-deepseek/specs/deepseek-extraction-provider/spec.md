## ADDED Requirements

### Requirement: DeepSeek selectable as extraction provider
The system SHALL support `TRIDENT_AI_PROVIDER=deepseek` to use DeepSeek V4 for screenshot extraction in place of OpenAI.

#### Scenario: DeepSeek selected with valid key
- **WHEN** `TRIDENT_AI_PROVIDER=deepseek` and `DEEPSEEK_API_KEY` is set
- **THEN** the server logs "AI extraction enabled" with provider `deepseek` and starts up normally

#### Scenario: DeepSeek selected with missing key
- **WHEN** `TRIDENT_AI_PROVIDER=deepseek` and `DEEPSEEK_API_KEY` is not set
- **THEN** the server logs an error and AI extraction is disabled (manual entry still works)

### Requirement: DeepSeek model and base URL are configurable
The system SHALL allow overriding the DeepSeek model name and API base URL via environment variables without a code change.

#### Scenario: Custom model override
- **WHEN** `DEEPSEEK_MODEL=deepseek-reasoner` is set
- **THEN** extraction calls use that model name instead of the default `deepseek-chat`

#### Scenario: Default base URL used when not overridden
- **WHEN** `DEEPSEEK_BASE_URL` is not set
- **THEN** the provider uses `https://api.deepseek.com/v1` as the base URL

### Requirement: Extraction result identifies DeepSeek as the provider
The extraction result returned by the API SHALL report `provider: "deepseek"` when DeepSeek is active.

#### Scenario: Provider field in extraction result
- **WHEN** extraction completes successfully with `TRIDENT_AI_PROVIDER=deepseek`
- **THEN** the JSON response contains `provider: "deepseek"` and the correct model name

### Requirement: OpenAI remains the default provider
The system SHALL continue to use OpenAI when `TRIDENT_AI_PROVIDER` is not set, preserving backwards compatibility.

#### Scenario: No provider env var set
- **WHEN** `TRIDENT_AI_PROVIDER` is unset and `OPENAI_API_KEY` is present
- **THEN** the server starts with the OpenAI provider as before
