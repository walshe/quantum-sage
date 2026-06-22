## MODIFIED Requirements

### Requirement: AI extraction prefers Opening Bell DVS
The AI extraction system SHALL extract `volatility.dvs` from the **Opening Bell Range column** (right panel) of the IV Smile chart when that value is non-zero. When the Opening Bell Range DVS is absent or zero (e.g. before the opening bell has occurred), the system SHALL fall back to the **Morning column** DVS (left panel).

#### Scenario: Opening Bell DVS is available and non-zero
- **WHEN** the IV Smile screenshot shows a non-zero DVS in the Opening Bell Range column
- **THEN** `volatility.dvs` in the extracted signal is set to the Opening Bell Range DVS value

#### Scenario: Opening Bell DVS is zero or absent
- **WHEN** the IV Smile screenshot shows 0.00 or blank in the Opening Bell Range DVS field
- **THEN** `volatility.dvs` in the extracted signal is set to the Morning column DVS value

#### Scenario: Morning-only screenshot
- **WHEN** the IV Smile screenshot only shows the Morning column (no Opening Bell Range column visible)
- **THEN** `volatility.dvs` in the extracted signal is set to the Morning DVS value

### Requirement: AI extraction includes Opening Bell levels when available
The AI extraction system SHALL extract range levels from the **Opening Bell Range column** when they are non-zero, populating `levels.max_buy_1`, `levels.max_buy_2`, `levels.max_sell_1`, `levels.max_sell_2` from the Opening Bell Range values. When Opening Bell Range levels are zero or absent, the system SHALL fall back to the Morning column levels.

#### Scenario: Opening Bell levels available
- **WHEN** the IV Smile screenshot shows non-zero Range 1/2 up/down values in the Opening Bell Range column
- **THEN** extracted levels use the Opening Bell Range values

#### Scenario: Opening Bell levels absent
- **WHEN** Opening Bell Range levels are 0.00 or blank
- **THEN** extracted levels fall back to Morning column values
