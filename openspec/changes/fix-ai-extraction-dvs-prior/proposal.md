## Why

When FB uploads two IV Smile screenshots (morning + afternoon), the AI incorrectly
populates `dvs_prior` with the afternoon/recalibrated DVS from the second chart instead
of leaving it `null`. `dvs_prior` is yesterday's DVS — a value that does not appear
anywhere in the standard screenshot set, so it should almost always be `null`.

## What Changes

- Clarify in the extraction prompt that `dvs_prior` = **yesterday's** closing DVS,
  not any same-day recalibration value; if not explicitly labeled as a prior-day figure,
  set it to `null`.
- Clarify that when two IV Smile charts are provided (morning and afternoon), both show
  today's session data — they do NOT represent today vs. yesterday. The two-column layout
  within a single chart ("Morning" vs "Opening/Afternoon") likewise represents two
  readings of today's session, not current-day vs prior-day.
- Investigate and fix why `max_sell_2` / `max_buy_2` are not being extracted from the
  SPX intraday chart when the labels are visible.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `ai-signal-extraction`: Extraction rules for `dvs_prior` and multi-chart IV Smile
  interpretation are changing. The prompt now explicitly prohibits mapping same-day
  recalibration columns to `dvs_prior`.

## Impact

- `trident/impl/nodejs/src/ai/prompts/signalExtractionPrompt.ts` — the only file that
  defines the extraction prompt; no schema or data-model changes required.
