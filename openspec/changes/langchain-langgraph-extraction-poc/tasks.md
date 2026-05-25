## 1. Install Dependencies

- [x] 1.1 Add `@langchain/core`, `@langchain/openai`, and `@langchain/langgraph` to `package.json` in `trident/impl/nodejs/`
- [x] 1.2 Run `npm install` and confirm no peer dependency conflicts
- [x] 1.3 Verify package versions are pinned (exact or `~`) and add a brief comment in `package.json` explaining why these three are present

## 2. LangChain Extraction Provider

- [x] 2.1 Create `src/ai/providers/LangChainExtractionProvider.ts` implementing `VisionProvider` using `ChatOpenAI` + `.withStructuredOutput(SIGNAL_TOOL_SCHEMA)`
- [x] 2.2 Accept the same constructor options as `OpenAIProvider` (`apiKey`, `model`, `baseURL`, `timeoutMs`) and pass `baseURL` via `configuration.baseURL` on `ChatOpenAI`
- [x] 2.3 Suppress LangSmith tracing in the constructor (`process.env.LANGCHAIN_TRACING_V2 ??= 'false'`)
- [x] 2.4 Map the `ChatOpenAI` response back to `ExtractionResult` (populate `provider`, `model`, `usage.inputTokens`, `usage.outputTokens`)
- [x] 2.5 Update `providers/index.ts` to instantiate `LangChainExtractionProvider` instead of `OpenAIProvider`

## 3. LangGraph Extraction Agent

- [x] 3.1 Define the `ExtractionState` interface (`images`, `callerKey`, `systemPrompt`, `result?`, `error?`, `blocked?`, `t0`)
- [x] 3.2 Implement and export `guardrailNode(state)` — calls `checkBeforeCall()`, sets `state.blocked` if rejected
- [x] 3.3 Implement and export `llmCallNode(state)` — calls `provider.extractSignal()`, stores result or sets `state.error`
- [x] 3.4 Implement and export `validateNode(state)` — calls `validateExtractionResult()`, sets `state.error` on `OutputValidationError`
- [x] 3.5 Implement and export `normaliseNode(state)` — applies the `normalise()` function to `state.result`
- [x] 3.6 Wire the four nodes into a `StateGraph` with conditional edges routing on `state.blocked` and `state.error`; export `buildExtractionGraph(provider)`
- [x] 3.7 Refactor `SignalExtractor.extract()` to compile the graph once in the constructor and call `graph.invoke(initialState)` — keep logging and metrics recording in `SignalExtractor`, not in nodes

## 4. Tests

- [x] 4.1 Add unit tests for `guardrailNode` in isolation (clean key → `blocked: false`; injection phrase → `blocked: true`)
- [x] 4.2 Add unit tests for `validateNode` in isolation (valid result → passes; out-of-range DVS → sets `error`)
- [x] 4.3 Add unit tests for `normaliseNode` in isolation (missing `update_seq` → defaults to 1; missing `vwap.source` → defaults to `'manual'`)
- [x] 4.4 Run existing extraction tests against the new provider — confirm all pass without modification
- [x] 4.5 Confirm `npm test` is fully green

## 5. Cleanup

- [x] 5.1 Delete `OpenAIProvider.ts` (or move to `_archive/` if you want easy rollback during the POC)
- [x] 5.2 Update `developer-mental-notes.md` — document the LangGraph node structure and where logging/metrics live vs. where they don't
- [x] 5.3 Update `ARCHITECTURE.md` if needed to reflect the new AI layer dependencies
