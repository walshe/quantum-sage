## Why

VWAP is a required field in every Trident setup and is currently entered manually
by the analyst after looking it up in a separate charting tool. This is a friction
point — it slows setup creation and introduces transcription errors. The cTrader
Open API already has an established connection; adding a button to derive VWAP
directly from the day's intraday bars removes the manual step entirely.

## What Changes

- A **Calculate** button is added to the right of the VWAP value field in the
  setup form (same `input-with-btn` pattern as the existing "now" / "today" buttons).
- Clicking it calls a new backend endpoint `GET /api/vwap` which:
  - Fetches today's intraday trend bars (1-minute M1) for the configured symbol
    via the cTrader Open API (ProtoOAGetTrendbarsReq).
  - Computes VWAP = Σ( (H+L+C)/3 × V ) / ΣV across all bars from midnight UTC
    to the current time.
  - Returns `{ vwap: number, barsUsed: number, asOf: string }`.
- The form populates the VWAP value input and updates "Updated at" to the current
  time on success.
- A spinner/disabled state covers the button during the fetch; an inline error
  message appears on failure.

## Capabilities

### New Capabilities

- `vwap-live-fetch`: Server-side VWAP calculation from intraday cTrader bar data,
  exposed via `GET /api/vwap` and wired to a Calculate button in the setup form.

### Modified Capabilities

<!-- None — existing VWAP field behaviour (manual entry, staleness warning) is unchanged. -->

## Impact

- **`src/price-feed/CTraderPriceFeed.ts`**: new `getTodayBars(period)` method that
  sends `ProtoOAGetTrendbarsReq` on the existing authenticated connection and
  resolves with an array of OHLCV bars.
- **`src/web/server.ts`**: new `GET /api/vwap` route.
- **`src/web/public/index.html`**: Calculate button added to VWAP `input-with-btn`.
- **`src/web/public/app.js`**: click handler, spinner state, field population.
- No schema changes, no breaking changes to the signal file format.
- Depends on the cTrader connection being authenticated; the endpoint returns 503
  if the feed is not connected.
