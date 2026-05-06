## MODIFIED Requirements

### Requirement: DVS prior extraction
`dvs_prior` SHALL be populated only when a screenshot explicitly labels a value as
yesterday's or previous-session's DVS. In the absence of such a label, `dvs_prior`
SHALL be `null`. Same-day recalibration values (e.g., the right column of a two-column
IV chart labeled "Opening" or "Afternoon") MUST NOT be mapped to `dvs_prior`.

#### Scenario: Single IV Smile chart — purple box present
- **WHEN** one IV Smile screenshot is provided and its right panel shows a purple-boxed
  DVS value alongside the green-boxed current DVS
- **THEN** the green box → `dvs`, the purple box → `dvs_prior`

#### Scenario: Single IV Smile chart — no purple box
- **WHEN** one IV Smile screenshot is provided and no prior-day box is visible
- **THEN** `dvs` is set from the green box, `dvs_prior` is `null`

#### Scenario: Two IV Smile charts (morning + afternoon)
- **WHEN** two IV Smile screenshots are provided (different timestamps, same date)
- **THEN** both charts are treated as today's session data; `dvs_prior` is `null`
  unless one chart explicitly labels a value as "yesterday" or "previous session"

#### Scenario: Two-column IV chart layout
- **WHEN** an IV Smile chart shows two side-by-side data columns (e.g., "Morning" left,
  "Opening/Afternoon" right)
- **THEN** the left column is today's morning reading, the right column is today's
  afternoon/recalibration reading; the right-column DVS MUST NOT be assigned to
  `dvs_prior`

### Requirement: Level extraction completeness
The extraction SHALL attempt to read all four level labels — MAX BUY 1, MAX BUY 2,
MAX SELL 1, MAX SELL 2 — from the SPX intraday chart. Any label that is present but
not extracted is a failure; a missing label SHALL produce `null` plus a warning.

#### Scenario: All four level labels visible
- **WHEN** the SPX intraday chart shows MAX BUY 1, MAX BUY 2, MAX SELL 1, MAX SELL 2
- **THEN** all four are extracted and placed in `levels.max_buy_1`, `levels.max_buy_2`,
  `levels.max_sell_1`, `levels.max_sell_2` respectively

#### Scenario: One or more level labels missing
- **WHEN** a level label is not visible on the chart
- **THEN** the corresponding field is `null` and a warning is added noting which levels
  are missing and that Trident will not trade that side
