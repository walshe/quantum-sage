## Context

The IV Smile chart's right panel can show one or two columns of range values depending on the time of day:

| Chart state | Left column | Right column |
|---|---|---|
| Before opening bell | Morning session ranges | Opening Bell Range — all `0.00` (not yet set) |
| After opening bell is set | Morning session ranges | Opening Bell Range — real values |

The extraction prompt currently contains contradictory guidance for the two-column case:
- One section says "Use the LEFT column values (today's session values; the right column is the prior-session comparison)" — correct in spirit for the no-opening-bell case.
- A later note says "The left column contains the morning session reading; the right column contains the afternoon/recalibrated reading" — a different, incompatible framing.

Because neither description names the columns' actual labels ("Morning" and "Opening Bell Range"), the model may misidentify which column to use, especially when the analyst uploads before the opening bell has fired. When this happens, all four levels land as `0.00` in the form, forcing the analyst to correct them manually.

The fix is prompt-only — no schema, TypeScript interface, or runtime logic changes are required.

## Goals / Non-Goals

**Goals:**
- Prompt clearly explains the two column labels ("Morning" and "Opening Bell Range") and their semantics.
- Prompt instructs the AI: if the Opening Bell Range column values are all `0.00`, use the Morning column values instead.
- Resolve the existing contradiction between the two "two-column panel" sections.

**Non-Goals:**
- Changing the JSON schema / `ExtractionResult` types.
- Adding TypeScript runtime fallback logic — the fallback is entirely a prompt concern.
- Changing how the form or engine processes the extracted values.

## Decisions

### Decision: Prompt-only fix

**Rationale:** The model has sufficient visual understanding to apply a conditional fallback rule stated in the prompt. Implementing the fallback in TypeScript code would require post-processing that inspects extracted values and re-instructs the model or hard-codes zero-detection — more moving parts than necessary for what is fundamentally a reading-comprehension task.

**Alternative considered:** Add a post-extraction TypeScript normalisation pass that detects all-zero Opening Bell values and re-maps from a second extraction call using only the left column. Rejected: double-call cost, added latency, and the model can do this in one pass given clear instructions.

### Decision: Opening Bell Range takes priority when non-zero

**Rationale:** The Opening Bell Range is the more specific, time-bounded reading (set at market open), so when it is available it should be preferred over the pre-open Morning reading. The prompt will codify: Opening Bell Range → primary; Morning → fallback when Opening Bell is all `0.00`.

### Decision: Resolve the two-column contradiction in the same edit

**Rationale:** The existing contradictory note already risks confusing the model in multi-screenshot scenarios. Fixing the fallback case without also resolving the contradiction would leave a latent hallucination risk.

## Risks / Trade-offs

- **[Risk] Model interprets a single non-zero Opening Bell value as "Opening Bell is set"** → Mitigation: prompt will specify "if ALL Opening Bell Range values are `0.00`" to avoid partial-zero edge cases being treated differently.
- **[Risk] Prompt change unexpectedly degrades extraction accuracy in other cases** → Mitigation: existing promptfoo eval suite (`npm run eval`) should catch regressions; a new fixture for the zero Opening Bell case can be added.
- **[Risk] Future chart layout changes** → No code to update; only the prompt needs changing again, which is low-effort.

## Migration Plan

1. Update `signalExtractionPrompt.ts` with clarified two-column section.
2. Run `npm test` to confirm no test regressions.
3. Run `npm run eval` to confirm no eval regressions.
4. (Optional) Add a promptfoo golden fixture for the zero Opening Bell fallback scenario.
5. No deployment steps beyond normal Docker publish — prompt change is picked up at next container build.
