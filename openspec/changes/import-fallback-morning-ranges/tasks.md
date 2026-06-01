## 1. Update Extraction Prompt

- [x] 1.1 In `signalExtractionPrompt.ts`, replace the "Right panel — ranges and levels" section header with clear column-label terminology: "Morning" (left) and "Opening Bell Range" (right)
- [x] 1.2 Add the fallback rule to the prompt: if all four Opening Bell Range values are `0.00`, use the Morning column values instead
- [x] 1.3 Remove / consolidate the contradictory "two-column data panel" note so there is a single, consistent description of the two-column layout and column precedence
- [x] 1.4 Update the "Hard rules" section to reference Morning vs Opening Bell Range column terminology (replace the vague "left column" phrasing)

## 2. Verification

- [x] 2.1 Run `npm test` from `trident/impl/nodejs/` and confirm all tests pass
- [x] 2.2 Run `npm run eval` and confirm no promptfoo regressions

## 3. Optional Eval Coverage

- [x] 3.1 Add a promptfoo golden fixture (in `evals/`) for the zero Opening Bell Range fallback scenario, using the analyst's screenshot as the test input and the Morning range values as the expected output
