## 1. CSS — quick-fill button style

- [x] 1.1 Add `.quick-fill-btn` style to `styles.css`: small, no background/border, low-contrast colour matching `.optional`, cursor pointer

## 2. HTML — add shortcut buttons to form fields

- [x] 2.1 Add `<button type="button" class="quick-fill-btn" data-quick-fill="today" data-target="meta.date">today</button>` inside the `meta.date` label (after the info icon, before the input)
- [x] 2.2 Add `<button type="button" class="quick-fill-btn" data-quick-fill="now" data-target="meta.timestamp">now</button>` inside the `meta.timestamp` label
- [x] 2.3 Add `<button type="button" class="quick-fill-btn" data-quick-fill="now" data-target="vwap.updated_at">now</button>` inside the `vwap.updated_at` label
- [x] 2.4 Add `<button type="button" class="quick-fill-btn" data-quick-fill="now" data-target="levels.level_time">now</button>` inside the `levels.level_time` label

## 3. JavaScript — delegated click handler

- [x] 3.1 Add `.quick-fill-btn` to the `I18N_TEXT_SELECTOR` array in `app.js` so buttons get translated (already covered by the existing `'button'` selector)
- [x] 3.2 Add a delegated `click` listener on `#signal-form` that handles `[data-quick-fill]` buttons: for `"now"` set the target input to current local HH:MM; for `"today"` set it to current local YYYY-MM-DD (using `getFullYear`/`getMonth`/`getDate` to stay in local timezone)

## 4. i18n — Italian translations

- [x] 4.1 Add `'now'` → `'adesso'` entry in `i18n.js`
- [x] 4.2 Add `'today'` → `'oggi'` entry in `i18n.js`

## 5. Verify

- [x] 5.1 Open the form — confirm "today" appears next to Date, "now" appears next to Time, VWAP Updated at, and Level time
- [x] 5.2 Confirm no button appears next to Expiry (invalidation)
- [x] 5.3 Click each button and confirm the correct value is stamped in the field
- [x] 5.4 Switch to Italian and confirm buttons show "adesso" / "oggi"
