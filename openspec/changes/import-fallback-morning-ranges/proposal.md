## Why

The IV Smile chart shows two columns: **Morning** (left) and **Opening Bell Range** (right). When the analyst uploads the chart before the opening bell has been set, the right column contains all `0.00` values. The current extraction prompt doesn't handle this case — the AI may attempt to use the zero-filled Opening Bell values instead of falling back to the valid Morning values, producing a useless extraction.

## What Changes

- Update the signal extraction prompt to teach the AI the two-column semantics: left = "Morning" ranges, right = "Opening Bell Range".
- Add a fallback rule: if all Opening Bell Range values are `0.00`, use the Morning column values instead.
- Clarify the existing "two-column panel" note in the prompt, which currently has contradictory guidance (in one place "right = prior-session comparison", in another "right = afternoon/recalibrated").

## Capabilities

### New Capabilities

- `morning-ranges-fallback`: When a two-column IV Smile panel is present and the Opening Bell Range column values are all `0.00`, the extraction falls back to the Morning column values for all four range/level fields.

### Modified Capabilities

<!-- No existing spec-level requirements are changing — this is a new extraction behaviour. -->

## Impact

- `trident/impl/nodejs/src/ai/prompts/signalExtractionPrompt.ts` — prompt text update only; no schema or TypeScript interface changes.
- No changes to `signalExtractor.ts`, `extractionGraph.ts`, or provider code.
- Evals in `trident/impl/nodejs/evals/` may need a golden fixture covering the fallback scenario.
