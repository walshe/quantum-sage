## 1. CTraderPriceFeed — getTodayBars()

- [x] 1.1 Define `OhlcvBar` interface (open, high, low, close, volume, timestamp) in `CTraderPriceFeed.ts`
- [x] 1.2 Add a `pendingBarRequests: Map<string, { resolve, reject, timer }>` field to `CTraderPriceFeed`
- [x] 1.3 Implement `getTodayBars(): Promise<OhlcvBar[]>` — generates a `clientMsgId`, sends `ProtoOAGetTrendbarsReq` (payloadType 2137) for PERIOD_M1 from midnight UTC to now, stores the pending entry, sets a 10 s timeout that rejects and cleans up
- [x] 1.4 In `handleMessage()`, handle `GET_TRENDBAR_RES` (payloadType 2138): look up pending request by `clientMsgId`, resolve with mapped bar array, clear timeout
- [x] 1.5 In `handleMessage()`, handle `ERROR_RES` (payloadType 2142): look up pending request by `clientMsgId`, reject with error message, clear timeout
- [x] 1.6 On WebSocket close/error, reject all pending bar requests immediately (don't wait for timeout)

## 2. Backend — GET /api/vwap route

- [x] 2.1 Add `GET /api/vwap` route to `src/web/server.ts`
- [x] 2.2 Return 503 `{ error: "feed not connected" }` if `priceFeed` is not a connected `CTraderPriceFeed`
- [x] 2.3 Call `priceFeed.getTodayBars()`, catch timeout/API errors and return 503 with appropriate message
- [x] 2.4 Return 503 `{ error: "no bars available" }` if the bar array is empty
- [x] 2.5 Compute VWAP: if total volume > 0, use Σ((H+L+C)/3 × V) / ΣV; if all volumes are zero, use simple typical-price average and set `volumeWarning: true`
- [x] 2.6 Return 200 `{ vwap: number, barsUsed: number, asOf: string, volumeWarning?: true }`

## 3. Frontend — Calculate button

- [x] 3.1 Wrap the VWAP value `<input>` in an `input-with-btn` `<div>` in `index.html`
- [x] 3.2 Add a `<button type="button" class="quick-fill-btn" id="vwap-calc-btn">Calculate</button>` inside the wrapper
- [x] 3.3 In `app.js`, add a click handler for `#vwap-calc-btn` that disables the button, sets its text to "…", and calls `GET /api/vwap`
- [x] 3.4 On success, populate the VWAP input with `response.vwap` (rounded to tick precision) and update the "Updated at" display
- [x] 3.5 On failure, show an inline error message beneath the field and re-enable the button with original label
- [x] 3.6 Clear any inline error on subsequent successful fetch

## 4. Tests

- [x] 4.1 Unit test `getTodayBars()` happy path (mock WebSocket reply with sample bars)
- [x] 4.2 Unit test `getTodayBars()` timeout (no reply within 10 s)
- [x] 4.3 Unit test `GET /api/vwap` — 503 when feed not connected
- [x] 4.4 Unit test `GET /api/vwap` — 200 with correct VWAP value for known bar set
- [x] 4.5 Unit test `GET /api/vwap` — `volumeWarning: true` when all volumes are zero
- [x] 4.6 Run full test suite (`npm test`) and confirm green

## 5. Documentation

- [x] 5.1 Update `developer-mental-notes.md` with the `clientMsgId` correlation pattern used in `getTodayBars()` and the verified payloadType numbers once confirmed
- [x] 5.2 Update `PHASE_1_ANALYST_GUIDE.md` to describe the Calculate button and when it can fail (feed must be connected)
- [x] 5.3 Update `ARCHITECTURE.md` to note the new `/api/vwap` endpoint and bar-fetch flow
