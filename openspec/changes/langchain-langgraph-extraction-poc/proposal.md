## Why

The current AI extraction pipeline calls the OpenAI API directly via a hand-rolled SDK wrapper (`OpenAIProvider.ts`). This works, but it reinvents orchestration patterns (prompt management, structured output, retries, streaming) that LangChain and LangGraph already solve well and in an industry-standard way. Adopting them makes the codebase more recognisable to other engineers, aligns with the direction the broader AI engineering field is moving, and demonstrates practical LLM framework experience.

## What Changes

- Replace the raw `@anthropic-ai/sdk` / `openai` SDK calls inside `OpenAIProvider.ts` with equivalent LangChain `ChatOpenAI` + structured-output chains.
- Introduce a `LangGraphExtractionAgent` that wraps the extraction flow as a LangGraph state graph — guardrail check → LLM call → output validation — replacing the manual pipeline in `signalExtractor.ts`.
- Keep the `VisionProvider` interface and all downstream code (`server.ts`, `signalExtractor.ts` public API) unchanged; this is a drop-in swap at the provider layer.
- Add `@langchain/core`, `@langchain/openai`, and `@langchain/langgraph` as dependencies (all MIT-licensed, no per-call cost — same underlying OpenAI API calls).
- The existing guardrail, output validator, PII redactor, and LLM logger modules are reused unchanged; LangGraph nodes call them directly.

## Capabilities

### New Capabilities

- `langchain-extraction-provider`: A `VisionProvider` implementation backed by a LangChain `ChatOpenAI` chain with `.withStructuredOutput()`, replacing the manual JSON-parsing flow in `OpenAIProvider.ts`.
- `langgraph-extraction-agent`: A LangGraph state graph that models the extraction pipeline as discrete nodes (guardrail → llm-call → validate → normalise), making the flow inspectable, testable per-node, and easy to extend with retries or fallback models.

### Modified Capabilities

*(none — no existing specs; all existing interfaces are preserved)*

## Impact

- **Dependencies added**: `@langchain/core`, `@langchain/openai`, `@langchain/langgraph` (all open source, MIT, no additional runtime cost).
- **Files modified**: `src/ai/providers/OpenAIProvider.ts` (replaced), `src/ai/signalExtractor.ts` (orchestration delegated to the graph).
- **Files unchanged**: `src/ai/guardrail.ts`, `src/ai/outputValidator.ts`, `src/ai/llmLogger.ts`, `src/ai/piiRedactor.ts`, `src/ai/types.ts`, `src/web/server.ts`.
- **No schema or API changes**: `POST /signals/extract` request/response shape is identical.
- **Test surface**: existing extraction tests should pass against the new provider; new unit tests cover individual LangGraph nodes.
- **LangSmith** (LangChain's observability platform) is optional and free-tier — not required for the POC.
