## Context

The setup form has several `<input type="date">` and `<input type="time">` fields. The native date/time picker requires the analyst to navigate to the correct hour and minute, which is slow during a live session. The most painful case is `vwap.updated_at`, which is re-stamped roughly once an hour throughout the trading day.

`meta.date` and `meta.timestamp` are already set to today/now by the "New setup" and "Update during session" button handlers — but not when pre-filling from the latest signal or from AI extraction. A "now"/"today" shortcut removes the fallback to the picker in every path.

## Goals / Non-Goals

**Goals:**
- Add a one-click shortcut to each targeted date/time field
- Keep the shortcut unobtrusive — it sits inline next to the field label, not as a separate toolbar
- Work in both English and Italian (i18n)

**Non-Goals:**
- Auto-updating the time automatically (clock-tick behaviour) — the analyst must consciously stamp the time
- Adding shortcuts to `invalidation.expiry` — that field takes a future end-of-day value, not "now"
- Any backend or schema changes

## Decisions

**Inline `<button type="button">` inside the `<label>`.**
Each `<label>` is already `display: flex; flex-direction: column`. Inserting a small button element after the info-tooltip icon and before the `<input>` puts it in the first flex row (with the label text), visually hugging the field name. No layout restructuring needed.

Alternative considered: a separate column of buttons next to each row. Rejected — too much extra markup and CSS, and would break the paired 2-column grid alignment.

**One delegated event listener on `#signal-form`** watches for clicks on `[data-quick-fill]` buttons. The `data-quick-fill` attribute is either `"now"` or `"today"`, and the button carries a `data-target` attribute naming the form field. This keeps app.js clean — no per-button listener.

Alternative considered: `onclick` attributes directly in the HTML. Rejected — harder to translate and harder to test.

**CSS class `quick-fill-btn`** — styled as a tiny, low-contrast chip (similar to `.optional` in spirit: small, italic-ish, visually secondary). No border, no background, cursor: pointer.

## Risks / Trade-offs

- [Timezone] `new Date()` uses the browser's local timezone, which is what the analyst wants — local trading time matches what they see on their charts. No risk.
- [Time format] `now.toTimeString().slice(0, 5)` gives `HH:MM` in local time, consistent with what `resetForNewSignal()` already does. Safe to reuse.
- [Date format] `now.toISOString().slice(0, 10)` gives UTC date, which could differ from local date near midnight. Mitigation: use `now.getFullYear()`, `getMonth()`, `getDate()` to build the local date string — same approach as is safe for any timezone.
