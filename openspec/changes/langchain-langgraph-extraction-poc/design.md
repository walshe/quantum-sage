## Context

The current extraction pipeline is in `src/ai/` and has three layers:

1. **`OpenAIProvider.ts`** — constructs the raw OpenAI SDK request (tool schema, base64 images, temperature), fires the call, parses the JSON response.
2. **`signalExtractor.ts`** — orchestrates: guardrail check → provider call → output validation → normalisation → logging/metrics. Linear `try/catch` flow.
3. **Supporting modules** (`guardrail.ts`, `outputValidator.ts`, `llmLogger.ts`, `piiRedactor.ts`) — reusable, no changes needed.

The public surface is `VisionProvider` (interface) and `SignalExtractor` (class). `server.ts` only touches these two — all other modules are internal.

LangChain (`@langchain/core` + `@langchain/openai`) and LangGraph (`@langchain/langgraph`) are MIT-licensed npm packages. They wrap the same underlying OpenAI HTTP calls, so runtime cost is identical. The POC replaces the two layers above; the supporting modules are untouched.

## Goals / Non-Goals

**Goals:**
- Replace `OpenAIProvider.ts` with a `LangChainExtractionProvider` that uses `ChatOpenAI` + `.withStructuredOutput()` for cleaner structured-output handling.
- Replace the imperative `try/catch` pipeline in `signalExtractor.ts` with a LangGraph state graph whose nodes map to the same steps (guardrail → LLM → validate → normalise).
- Keep `VisionProvider` interface and `SignalExtractor` public API identical — zero changes to `server.ts` or any caller.
- Reuse all existing supporting modules unchanged.
- Add unit tests for each LangGraph node in isolation.

**Non-Goals:**
- Adding LangSmith observability (optional, deferred — existing Loki/Prometheus stack is sufficient).
- Switching models, changing the system prompt, or altering extraction behaviour.
- Using LangChain agents or chains beyond structured output (no ReAct, no memory, no retrieval).
- Supporting providers other than OpenAI (DeepSeek is configured via `OPENAI_BASE_URL` already).

## Decisions

### 1. LangChain for the provider layer only

**Decision**: Use `ChatOpenAI.withStructuredOutput(schema)` in a new `LangChainExtractionProvider` to replace the manual tool-calling boilerplate in `OpenAIProvider.ts`. Keep the `VisionProvider` interface — the provider is still swappable.

**Rationale**: `.withStructuredOutput()` handles the tool-schema construction, response parsing, and null-coercion internally. The SIGNAL_TOOL_SCHEMA stays as-is; LangChain simply wraps it. This is the most visible "industry standard" pattern — it's the idiomatic LangChain way to get typed structured output from a chat model.

**Alternative considered**: Zod schema instead of JSON Schema for `.withStructuredOutput()`. Rejected for the POC — the existing JSON Schema in `OpenAIProvider.ts` is large but already correct; rewriting it in Zod is busywork and Zod adds a dependency. Can be done later.

---

### 2. LangGraph for the orchestration layer

**Decision**: Refactor `SignalExtractor.extract()` to delegate to a `buildExtractionGraph()` LangGraph `StateGraph`. Nodes map 1:1 to the current pipeline steps:

```
guardrail ──(blocked?)──► [end: throw ExtractionBlockedError]
   │
   ▼
llm-call ──(error?)──► [end: log + throw]
   │
   ▼
validate ──(error?)──► [end: log + throw]
   │
   ▼
normalise
   │
   ▼
[end: return result]
```

State shape:
```ts
interface ExtractionState {
  images: ImageInput[];
  callerKey?: string;
  result?: ExtractionResult;
  error?: Error;
  blocked?: boolean;
  t0: number;
}
```

Conditional edges use LangGraph's `addConditionalEdges` to route on `state.blocked` and `state.error`.

**Rationale**: LangGraph's explicit node/edge model makes the flow inspectable and each node independently testable. It also demonstrates the real-world use case (multi-step agentic pipeline with conditional routing) rather than just using LangChain as a fancy HTTP wrapper.

**Alternative considered**: Keeping `signalExtractor.ts` as a flat function and only swapping the provider. Rejected — the orchestration layer is where LangGraph's value is visible. Using it only for the provider call would be underwhelming as a POC and miss the point.

---

### 3. `SignalExtractor` delegates to the graph, does not become the graph

**Decision**: `SignalExtractor` is kept as a thin class. Its `extract()` method constructs the initial state and calls `graph.invoke()`. Logging, metrics recording, and `flushMetrics()` stay in `SignalExtractor` — they are cross-cutting concerns, not pipeline steps.

**Rationale**: LangGraph nodes should be pure data transforms. Metrics accumulation is stateful and session-scoped — it belongs outside the graph. This keeps nodes testable without needing a `SignalExtractor` instance.

---

### 4. No new external processes or services

**Decision**: LangSmith tracing is disabled (set `LANGCHAIN_TRACING_V2=false` explicitly in the provider constructor to suppress the warning). No LangSmith account or API key is needed.

**Rationale**: The existing structured logging (Winston → Loki) and Prometheus metrics cover observability requirements. LangSmith would be additive but is not needed to validate the framework choice.

## Risks / Trade-offs

- **LangChain version churn** → Pin exact versions in `package.json`. LangChain's API has stabilised significantly at `@langchain/core` ≥ 0.3; breaking changes between minor versions are now rare.
- **`.withStructuredOutput()` hides the raw tool response** → If the model returns an unexpected shape, LangChain throws an internal parse error with less context than the current manual JSON.parse. Mitigation: the existing `outputValidator.ts` runs after the LangChain call and provides the detailed error.
- **LangGraph adds ~150KB to the bundle** → Not a concern for a Node.js server process; no browser bundle here.
- **Increased abstraction makes debugging harder** → Mitigation: keep all log statements inside the nodes using the existing `getLogger()`, so the call sequence is still visible in structured logs.

## Migration Plan

1. Install the three new packages.
2. Create `LangChainExtractionProvider` alongside `OpenAIProvider` (both implement `VisionProvider`).
3. Refactor `signalExtractor.ts` to use the LangGraph graph internally.
4. Update `providers/index.ts` to instantiate `LangChainExtractionProvider` instead of `OpenAIProvider`.
5. Run existing tests — no changes needed if the public API is preserved.
6. Add per-node unit tests.
7. Delete `OpenAIProvider.ts` once tests are green.

**Rollback**: `providers/index.ts` is the only wiring point. Reverting it to `OpenAIProvider` restores the prior behaviour in one line. `OpenAIProvider.ts` can be kept (but not exported) during the POC for easy rollback.

## Open Questions

- Should `LangChainExtractionProvider` be renamed to just `OpenAIProvider` (same filename) once stable, or kept distinct to signal the framework choice?
- The existing `SIGNAL_TOOL_SCHEMA` is JSON Schema. Evaluate at implementation time whether converting to Zod gives enough benefit (better TypeScript inference) to justify the extra work.
- Confirm `@langchain/langgraph` peer dependency on `@langchain/core` is compatible with the version we install for the provider.
