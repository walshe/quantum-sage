## Why

Every time the analyst refreshes VWAP mid-session they must open the `Updated at` time picker and scroll to the current hour and minute — a slow, error-prone step that directly delays the setup reaching the engine. The same friction applies to `Level time` when entering a recalibration. "Now" and "Today" shortcut buttons eliminate the picker interaction for the common case.

## What Changes

- Add a small **"now"** button inline with each of these time fields: `meta.timestamp`, `vwap.updated_at`, `levels.level_time`. Clicking it sets the field to the current local time (HH:MM).
- Add a small **"today"** button inline with the `meta.date` field. Clicking it sets the field to today's date in YYYY-MM-DD format.
- Do **not** add a "now" button to `invalidation.expiry` — that field is almost always set to a future end-of-day time, not "right now".
- Add Italian translations for the button labels (`'now'` → `'adesso'`, `'today'` → `'oggi'`).
- No backend changes; no schema changes.

## Capabilities

### New Capabilities

- `quick-date-time-fill`: Inline shortcut buttons on date and time inputs that stamp the current date/time with one click.

### Modified Capabilities

_(none)_

## Impact

- `trident/impl/nodejs/src/web/public/index.html` — four button elements added inside existing `<label>` tags
- `trident/impl/nodejs/src/web/public/styles.css` — small style for the shortcut button
- `trident/impl/nodejs/src/web/public/app.js` — one delegated click handler; button labels added to the i18n selector
- `trident/impl/nodejs/src/web/public/i18n.js` — two new translation entries
