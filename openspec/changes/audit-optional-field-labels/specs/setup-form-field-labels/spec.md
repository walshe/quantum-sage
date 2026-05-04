## ADDED Requirements

### Requirement: MAX level fields display a paired badge
The four tradeable level fields (MAX SELL 1, MAX SELL 2, MAX BUY 1, MAX BUY 2) in the setup form's Levels fieldset SHALL display a `(paired)` badge instead of an `(optional)` badge, using the existing `.optional` CSS class so the visual style is unchanged.

#### Scenario: Analyst opens the setup form
- **WHEN** the analyst opens the setup form (new, update, or pre-fill)
- **THEN** MAX SELL 1, MAX SELL 2, MAX BUY 1, and MAX BUY 2 each show a `(paired)` badge next to the field label

#### Scenario: Other optional fields unaffected
- **WHEN** the analyst views Contract, Level time, Support, Resistance, Bias fields, or Invalidation notes
- **THEN** those fields still show `(optional)` badges, unchanged

### Requirement: Levels fieldset displays a pairing-rule note
The Levels fieldset SHALL contain a short inline note, rendered between the `<legend>` tag and the first input, explaining the pairing constraint in plain language.

The note text SHALL be: "Provide as complete pairs (both MAX BUY 1+2, or both MAX SELL 1+2, or both). At least one pair is required — the engine skips a side whose pair is incomplete."

#### Scenario: Note is visible before the analyst fills in levels
- **WHEN** the analyst opens the setup form to a state where the Levels fieldset is visible
- **THEN** the pairing-rule note appears above the level inputs, inside the Levels fieldset

#### Scenario: Note is translated in Italian mode
- **WHEN** the analyst switches the UI to Italian
- **THEN** the pairing-rule note is displayed in Italian

### Requirement: Italian i18n entries cover the new strings
The `i18n.js` translation table SHALL include entries for:
- The `(paired)` label string
- The full pairing-rule note string

#### Scenario: Italian translation of paired badge
- **WHEN** language is set to Italian
- **THEN** the `(paired)` badge text is rendered in Italian (e.g. `(accoppiato)`)

#### Scenario: Italian translation of pairing note
- **WHEN** language is set to Italian
- **THEN** the pairing-rule note sentence is rendered in Italian
