## Context

The extraction pipeline (`SignalExtractor` → `LangChainExtractionProvider` → OpenAI) has 100% unit-test coverage of its plumbing, but zero coverage of extraction *quality*. The only way to know whether the prompt works is to try it manually. This is the gap promptfoo fills.

The pipeline is already well-structured for testing: `SignalExtractor.extract()` takes `ImageInput[]` and returns a structured `ExtractionResult`. A promptfoo provider just needs to call that function and let promptfoo evaluate the result.

Current state: `LANGCHAIN_TRACING_V2=false` is set in the provider constructor — no LangSmith dependency. This design stays consistent: no external eval service, everything runs locally.

## Goals / Non-Goals

**Goals:**
- Run a fixed set of IV Smile screenshots through the real extraction pipeline and assert on key fields
- Detect regressions when the prompt, model, or schema changes
- Run locally with a single `npm run eval` command; results printed to terminal
- Reuse the existing `SignalExtractor` — no parallel implementation of extraction logic

**Non-Goals:**
- LLM-as-judge scoring (pass/fail field assertions are sufficient for structured output)
- CI integration (real API calls cost money; kept as a manual developer tool)
- Evaluating extraction quality across multiple models simultaneously (single-model for now)
- Testing the guardrail or output validator in isolation (already covered by unit tests)

## Decisions

### D1: Custom promptfoo provider over native promptfoo YAML prompt config

**Decision**: Write a small Node.js custom provider (`evals/provider.ts`) that calls `SignalExtractor.extract()` directly, rather than configuring promptfoo to call the OpenAI API directly with the raw prompt.

**Rationale**: The extraction pipeline includes the guardrail, structured output schema enforcement, and output validation layers. Bypassing them would test a different thing than what runs in production. The custom provider reuses all of it — a pass in eval means the full pipeline passed, not just the prompt.

**Alternative considered**: Native `openai` provider in promptfoo YAML with the system prompt inline. Rejected because it skips the LangChain structured output schema, the guardrail, and `outputValidator` — a pass wouldn't prove the production code works.

### D2: Golden dataset stored as committed files

**Decision**: Screenshot images checked into `evals/fixtures/` alongside a `dataset.yaml` that records expected field values for each screenshot.

**Rationale**: Screenshots are small (<100KB each), immutable reference data, and git history gives a clear audit trail of when the baseline changed. `dataset.yaml` is human-readable and easy to update when the expected output legitimately changes.

**Alternative considered**: External dataset store (S3, LangSmith dataset). Rejected — adds an external dependency and makes local runs harder.

### D3: Field-level pass/fail assertions, not semantic scoring

**Decision**: Assertions check exact or tolerance-bounded numeric values (`dvs` within ±1, level prices within ±5 points) plus enum correctness (`regime`). No LLM-as-judge step.

**Rationale**: The extraction output is fully structured and numeric. Semantic scoring would add cost and noise for a problem where "correct" is well-defined. Tolerance bounds handle minor OCR variance across chart renders.

## Risks / Trade-offs

- **Dataset becomes stale** → Mitigation: `dataset.yaml` has a `captured_on` field; a comment in the file reminds maintainers to re-validate when the prompt changes significantly.
- **Real API cost per eval run** → Mitigation: `npm run eval` is not in CI; developers run it deliberately. Dataset kept small (3–5 screenshots) to keep cost negligible (~$0.05/run at gpt-4o pricing).
- **Screenshot format changes** → If IV Smile chart layout changes, existing fixtures may no longer reflect what FB sends. Mitigation: add a new fixture and keep old ones so regressions against historical charts are still detectable.
- **promptfoo version drift** → Pinned as a dev dependency; breaking changes handled at upgrade time.

## Open Questions

- Which specific IV Smile screenshots should seed the initial dataset? (FB to provide 2–3 representative ones — ideally covering: normal DVS, elevated DVS, two-column chart layout.)
- Tolerance on level prices: ±5 futures points proposed — confirm with FB whether OCR variance can be larger.
