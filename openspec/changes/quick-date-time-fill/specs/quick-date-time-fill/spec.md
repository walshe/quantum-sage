## ADDED Requirements

### Requirement: "now" shortcut button on time fields
The setup form SHALL display a small "now" button inline with the label of `meta.timestamp`, `vwap.updated_at`, and `levels.level_time`. Clicking the button SHALL set that field's value to the current local time in HH:MM format. The button SHALL NOT appear on `invalidation.expiry`.

#### Scenario: Analyst clicks "now" on VWAP updated_at
- **WHEN** the analyst clicks the "now" button next to the `Updated at` field
- **THEN** the `vwap.updated_at` input is set to the current local time (HH:MM)

#### Scenario: Analyst clicks "now" on setup timestamp
- **WHEN** the analyst clicks the "now" button next to the `Time` field (meta.timestamp)
- **THEN** the `meta.timestamp` input is set to the current local time (HH:MM)

#### Scenario: Analyst clicks "now" on level time
- **WHEN** the analyst clicks the "now" button next to the `Level time` field
- **THEN** the `levels.level_time` input is set to the current local time (HH:MM)

#### Scenario: No "now" button on invalidation expiry
- **WHEN** the analyst views the Invalidation fieldset
- **THEN** the `Expiry` field has no quick-fill button

### Requirement: "today" shortcut button on the date field
The setup form SHALL display a small "today" button inline with the label of `meta.date`. Clicking the button SHALL set the field's value to today's date in YYYY-MM-DD format using the browser's local timezone.

#### Scenario: Analyst clicks "today" on the date field
- **WHEN** the analyst clicks the "today" button next to the `Date` field
- **THEN** the `meta.date` input is set to today's local date in YYYY-MM-DD format

### Requirement: Quick-fill buttons are translated in Italian mode
The "now" and "today" button labels SHALL be translated when the UI language is switched to Italian (`'now'` → `'adesso'`, `'today'` → `'oggi'`).

#### Scenario: Italian translation of "now" button
- **WHEN** the UI language is set to Italian
- **THEN** all "now" buttons display "adesso"

#### Scenario: Italian translation of "today" button
- **WHEN** the UI language is set to Italian
- **THEN** the "today" button displays "oggi"

### Requirement: Quick-fill buttons are visually secondary
The quick-fill buttons SHALL be visually unobtrusive — small, low-contrast, and clearly subordinate to the field label — so they do not distract from the form's data entry focus.

#### Scenario: Button appearance
- **WHEN** the setup form is open
- **THEN** each quick-fill button appears as a small inline chip next to its field label, without a border or background that competes with the main form controls
