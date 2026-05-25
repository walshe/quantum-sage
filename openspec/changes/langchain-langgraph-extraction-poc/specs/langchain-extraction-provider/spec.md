## ADDED Requirements

### Requirement: LangChain provider implements VisionProvider interface
`LangChainExtractionProvider` SHALL implement the `VisionProvider` interface (`name`, `model`, `extractSignal(images, systemPrompt)`), making it a drop-in replacement for `OpenAIProvider` with no changes required in callers.

#### Scenario: Provider is used via the VisionProvider interface
- **WHEN** `buildVisionProvider()` returns a `LangChainExtractionProvider`
- **THEN** `SignalExtractor` accepts it without modification and `POST /signals/extract` behaves identically to the previous implementation

### Requirement: Structured output via ChatOpenAI.withStructuredOutput
The provider SHALL use `ChatOpenAI` from `@langchain/openai` with `.withStructuredOutput(SIGNAL_TOOL_SCHEMA)` to obtain a typed response, replacing the manual tool-calling and JSON.parse flow.

#### Scenario: Successful extraction returns typed result
- **WHEN** a valid IV Smile screenshot is submitted
- **THEN** the provider returns an `ExtractionResult` with `signal`, `notes`, `warnings`, `provider`, `model`, and `usage` fields populated without any manual JSON parsing by the caller

#### Scenario: Model returns unexpected shape
- **WHEN** the model response does not conform to `SIGNAL_TOOL_SCHEMA`
- **THEN** LangChain throws a parse error which propagates as an `Error` to the caller (caught by the LangGraph validate node)

### Requirement: Provider configuration matches existing options
The provider SHALL accept the same constructor options as `OpenAIProvider` (`apiKey`, `model`, `baseURL`, `timeoutMs`) so `providers/index.ts` requires minimal changes.

#### Scenario: Custom base URL for DeepSeek compatibility
- **WHEN** `OPENAI_BASE_URL` is set in the environment
- **THEN** `ChatOpenAI` is initialised with `configuration.baseURL` set to that value, preserving DeepSeek-via-OpenAI-compat support

### Requirement: LangSmith tracing is disabled by default
The provider SHALL set `LANGCHAIN_TRACING_V2=false` in its constructor (if not already set) so no network calls are made to LangSmith and no API key is required.

#### Scenario: No LangSmith environment variables configured
- **WHEN** `LANGSMITH_API_KEY` is absent from the environment
- **THEN** the provider initialises without warnings and makes no outbound calls to `api.smith.langchain.com`
