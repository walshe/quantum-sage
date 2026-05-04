## Why

The setup form labels four fields — MAX SELL 1, MAX SELL 2, MAX BUY 1, MAX BUY 2 — as "(optional)", but the validator enforces a pairing constraint: both members of a pair must be present if either is used, and at least one complete pair (BUY pair or SELL pair) must be provided for the engine to have anything to trade. The current labels give no hint of this, so an analyst could submit a setup with all four blank and receive a validation error that feels unexpected.

## What Changes

- Add a short constraint note inside the Levels fieldset (above the level fields) explaining the pairing rule: "At least one pair required — provide both MAX BUY 1+2 or both MAX SELL 1+2 (or both). The engine skips a side if its pair is incomplete."
- Change the four MAX level field labels from plain `(optional)` to `(paired)` to signal they are conditionally required in pairs, not freely skippable.
- Update the `i18n.js` Italian translation table to include translations for the new note and the `(paired)` label.
- All other `(optional)` labels (`meta.contract`, `levels.level_time`, `levels.supporto`, `levels.resistenza`, `bias.*`, `invalidation.notes`) are correctly labeled — no changes needed there.

## Capabilities

### New Capabilities

- `setup-form-field-labels`: Correctness of form field labels and inline help in the setup modal, including the pairing rule for tradeable levels.

### Modified Capabilities

_(none — no existing specs to update)_

## Impact

- `trident/impl/nodejs/src/web/public/index.html` — label and note changes inside the Levels fieldset
- `trident/impl/nodejs/src/web/public/i18n.js` — new translation entries for the note string and `(paired)` label
- No backend changes; no schema changes; no validator changes
