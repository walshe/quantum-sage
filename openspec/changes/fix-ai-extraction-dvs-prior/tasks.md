## 1. Fix `dvs_prior` extraction rule

- [x] 1.1 In `signalExtractionPrompt.ts`, rewrite the "purple box → dvs_prior" description
      to explicitly define `dvs_prior` as **yesterday's closing DVS** and state it is
      almost always `null` in FB's screenshots
- [x] 1.2 Add a rule that same-day recalibration values (right column of a two-column
      layout, labeled "Opening" or "Afternoon") MUST NOT be assigned to `dvs_prior`

## 2. Add multi-chart IV Smile guidance

- [x] 2.1 Add a note explaining that when two IV Smile screenshots are present they both
      represent today's session (morning and afternoon); neither is a "prior day" chart
- [x] 2.2 Add a note explaining the two-column layout: left = morning, right = afternoon
      recalibration; both columns are today's data

## 3. Fix level extraction completeness

- [x] 3.1 Add explicit instruction that all four labels (MAX BUY 1, MAX BUY 2, MAX SELL 1,
      MAX SELL 2) must be extracted when visible; silently dropping one is a failure
- [x] 3.2 Confirm the warnings list mentions missing MAX BUY 2 / MAX SELL 2 separately
      (not just "MAX BUY 1/2 missing" as a bundle)

## 4. Verify

- [x] 4.1 Re-run the extraction with the same three screenshots (morning IV, SPX intraday,
      afternoon IV) and confirm `dvs_prior` is `null` and `dvs` = 56.30
- [x] 4.2 Confirm MAX SELL 2 and MAX BUY 2 are extracted from the intraday chart
- [x] 4.3 Confirm `levels_recal.*` is populated from the 15:30 label set if present
