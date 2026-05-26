## ADDED Requirements

### Requirement: Two-column panel column identification
The extraction prompt SHALL identify the two columns of the IV Smile range panel by their on-chart labels: the **left column** is labelled "Morning" and the **right column** is labelled "Opening Bell Range" (sometimes rendered as "Opening Bell" or abbreviated).

#### Scenario: Single-column panel
- **WHEN** the IV Smile chart shows only one column of range values
- **THEN** the extractor SHALL use those values for all four range/level fields

#### Scenario: Two-column panel — Opening Bell Range has real values
- **WHEN** the IV Smile chart shows a two-column panel
- **AND** the Opening Bell Range column (right) contains non-zero numeric values
- **THEN** the extractor SHALL use the Opening Bell Range (right column) values for `ranges.*` and `levels.*`

#### Scenario: Two-column panel — Opening Bell Range is all zero
- **WHEN** the IV Smile chart shows a two-column panel
- **AND** all four Opening Bell Range column (right) values are `0.00`
- **THEN** the extractor SHALL fall back to the Morning column (left column) values for `ranges.*` and `levels.*`

#### Scenario: Two-column panel — Opening Bell Range partially zero
- **WHEN** the IV Smile chart shows a two-column panel
- **AND** at least one Opening Bell Range column (right) value is non-zero but one or more are `0.00`
- **THEN** the extractor SHALL use the non-zero Opening Bell Range values where available and `null` for zero/missing entries (not substitute Morning values per-field)

### Requirement: Opening Bell Range zero fallback does not affect DVS
The fallback from Opening Bell Range to Morning range values SHALL apply only to the four range/level fields (`range_1_up`, `range_2_up`, `range_2_down`, `range_1_down` and their `levels.*` equivalents). DVS extraction from its labeled box is independent and unaffected by column selection.

#### Scenario: DVS extracted regardless of column choice
- **WHEN** the extractor falls back to Morning column range values because Opening Bell Range is all zero
- **THEN** `volatility.dvs` SHALL still be populated from the clearly-labeled DVS box on the chart
- **AND** `volatility.dvs_prior` SHALL remain `null` unless explicitly labeled as yesterday's value

### Requirement: Prompt contradictions resolved
The extraction prompt SHALL NOT contain contradictory instructions about which column to use. All references to the two-column layout SHALL use the "Morning" / "Opening Bell Range" terminology consistently.

#### Scenario: Consistent column labelling in prompt
- **WHEN** the model processes a two-column IV Smile screenshot
- **THEN** all instructions in the prompt about the two-column layout SHALL point to the same source of truth (Opening Bell Range preferred; Morning fallback when Opening Bell is all zero)
