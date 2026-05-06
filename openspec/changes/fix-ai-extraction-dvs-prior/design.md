## Context

The AI extraction pipeline uses a single system prompt (`signalExtractionPrompt.ts`) fed
to GPT-4o with 2-3 screenshots. The prompt currently describes the IV Smile right panel
as having "green box → dvs (current), purple box → dvs_prior (prior/realtime)". This
description is correct for a single-chart reading, but breaks when an afternoon IV Smile
is included alongside the morning one.

The afternoon IV Smile chart has a **two-column layout** in its data panel:
- Left column: "Morning" — today's opening session values
- Right column: "Opening/Afternoon" — today's recalibrated values

The AI sees two DVS numbers in the second chart and, following the "current / prior"
framing, assigns the right-column DVS to `dvs_prior`. But `dvs_prior` means **yesterday's
closing DVS** — a value never shown in any of FB's standard screenshots.

## Goals / Non-Goals

**Goals:**
- Prevent `dvs_prior` from being set to any same-day recalibration value.
- Teach the model that two IV charts = morning session + afternoon recalibration, both today.
- Teach the model that the two-column layout within one chart = two today-readings, not today-vs-yesterday.
- Investigate and fix the silent drop of `max_sell_2` / `max_buy_2` from the intraday chart.

**Non-Goals:**
- Changing the data schema or validator.
- Adding a UI field for `dvs_prior` (analyst enters it manually if needed).
- Handling any screenshot format other than the current FB terminal screenshots.

## Decisions

**D1 — Rewrite the `dvs_prior` extraction rule**

Current text ambiguously calls it "prior/realtime". Replace with an explicit definition:
> `dvs_prior` = yesterday's **closing** DVS. It is almost never visible in FB's
> screenshots. Set to `null` unless the chart explicitly labels a value as "yesterday"
> or "previous session". Same-day recalibration values (labeled "Opening", "Afternoon",
> or appearing in the right column of a two-column chart) are NOT `dvs_prior`.

**D2 — Add a multi-chart rule for IV Smile screenshots**

When two IV Smile charts are present:
- The first (earlier timestamp) = morning session snapshot.
- The second (later timestamp) = afternoon/recalibration snapshot.
- Both are from **today's session**. Do not treat the second as a "prior day" chart.
- Extract `dvs` from whichever chart has the more recent / authoritative DVS value
  (typically the afternoon chart's left-column "Morning" green box, or use the afternoon
  recalibrated value if labeled as the primary reading).

**D3 — Clarify two-column layout meaning**

Add a note explaining:
> Some IV Smile charts show two side-by-side columns. The left column is the morning
> reading; the right column is the afternoon/recalibration reading. Both belong to today.
> The right column values do NOT map to `dvs_prior`.

**D4 — Explicit `max_sell_2` / `max_buy_2` guidance**

The current prompt lists "10:00 MAX SELL 2" and "10:00 MAX BUY 2" in the label examples
but doesn't explicitly state they must be extracted. Add a rule that all four labels
(MAX BUY 1, MAX BUY 2, MAX SELL 1, MAX SELL 2) must be extracted when visible; missing
ones are `null` with a warning.

## Risks / Trade-offs

- [Risk] Overly prescriptive prompt may cause the model to ignore a `dvs_prior` value
  that IS actually labeled as yesterday's on an unusual chart variant. → Mitigation:
  the rule says "unless explicitly labeled as yesterday" so genuine prior-day labels
  are still captured.
- [Risk] Prompt length is growing. → Mitigation: this is a targeted addition of ~8-10
  lines; well within GPT-4o context limits.
