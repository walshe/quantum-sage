## Context

The cTrader Open API connection (`CTraderPriceFeed`) is already authenticated and
running by the time the analyst opens the setup form. It currently handles only
real-time spot ticks. The API also supports historical bar data via
`ProtoOAGetTrendbarsReq` (payloadType 2137) on the same authenticated connection —
the same JSON port, same `clientMsgId`-based correlation pattern.

VWAP formula used throughout Trident: Σ( (H+L+C)/3 × V ) / ΣV (typical price VWAP).

## Goals / Non-Goals

**Goals:**
- One-click VWAP population from the day's live bar data, no external tool needed.
- Endpoint returns a number ready to paste into the signal — no further rounding needed.
- Graceful failure: clear error if feed is disconnected or bars are unavailable.

**Non-Goals:**
- Real-time VWAP updating (it's a snapshot on demand, like the "now" button).
- Support for non-cTrader price feeds (MockPriceFeed returns a 503).
- VWAP anchoring from custom start times or from a prior session.

## Decisions

### 1. Reuse the existing authenticated WebSocket connection

**Decision:** Send `ProtoOAGetTrendbarsReq` on the already-open connection in
`CTraderPriceFeed` rather than opening a second connection.

**Rationale:** Avoids a second auth handshake, keeps all cTrader I/O in one class,
and the JSON port accepts both spot subscriptions and bar requests on the same socket.

**Alternative considered:** Separate HTTP REST client to a data vendor. Rejected —
adds a third-party dependency and another API key for something the existing feed
can do natively.

### 2. Promise-based correlation for the bar request

**Decision:** `getTodayBars()` creates a pending `{ resolve, reject }` entry keyed
by `clientMsgId`, sends the request, and resolves/rejects when `handleMessage()`
sees the matching `GET_TRENDBAR_RES` (2138) or `ERROR_RES` (2142).

**Rationale:** The API is event-driven (no `await` for replies). This is the same
pattern used in standard cTrader SDK wrappers and keeps the public API simple
(`async getTodayBars(): Promise<OhlcvBar[]>`).

**Alternative considered:** Polling with a callback registry. Rejected — harder to
propagate errors and timeout cleanly.

### 3. M1 (1-minute) bars from midnight UTC to now

**Decision:** Fetch `PERIOD_M1` bars for the current UTC trading day
(00:00:00 UTC today → now). Compute VWAP over all returned bars.

**Rationale:** M1 gives enough granularity for an accurate daily VWAP without
requesting an impractical number of bars (≤ 1440 bars per day). cTrader returns
bars in the requested window inclusive.

**Alternative considered:** M5 bars. Rejected — coarser VWAP, only saves ~280 msgs.

### 4. 503 when feed is not connected

**Decision:** `GET /api/vwap` returns HTTP 503 with `{ error: "feed not connected" }`
if `CTraderPriceFeed` is not in the authenticated+connected state.

**Rationale:** The endpoint is meaningless without a live feed. 503 is the correct
HTTP status for a temporarily unavailable upstream dependency.

### 5. UI: same `input-with-btn` pattern, distinct button style

**Decision:** The Calculate button sits inside the existing `input-with-btn` wrapper
next to the VWAP value input. It gets the same `.quick-fill-btn` class. A spinner
state (button disabled, text "…") covers the async fetch.

**Rationale:** Consistent with the "now" / "today" buttons already in the form.
No new CSS patterns needed.

## Risks / Trade-offs

- **Volume missing on some accounts**: Some cTrader demo accounts return bars with
  `volume: 0`. If all bars have zero volume, VWAP calculation degenerates to a
  simple price average — document in endpoint response with a `volumeWarning` flag.
- **Large bar count at end of day**: Up to 1 440 M1 bars. Adds ~50–100 ms latency
  on slow connections. Spinner covers this.
- **Single pending request at a time**: Only one outstanding `getTodayBars()` call
  is safe; concurrent calls would race on the same message handler. Endpoint
  serialises this naturally (one HTTP request at a time per tab).
- **Feed reconnects mid-request**: If the WebSocket drops while a bar request is
  in-flight, the pending promise is rejected with a timeout (10 s). Button shows
  an error and re-enables.

## Migration Plan

No migration needed. The endpoint is additive; no schema changes; no config changes.
Deploy as a normal image update.

## Open Questions

- **cTrader bar payloadType numbers**: 2137 (GET_TRENDBAR_REQ) and 2138
  (GET_TRENDBAR_RES) are from the public proto definitions — verify against the
  live JSON port before shipping (easy to confirm with a single test send).
- **PERIOD_M1 constant value**: Confirm the integer cTrader uses for M1 in the JSON
  protocol (expected: 1 based on proto enum, but worth verifying).
