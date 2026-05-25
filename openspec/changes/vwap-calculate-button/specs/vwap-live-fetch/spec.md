## ADDED Requirements

### Requirement: VWAP endpoint returns daily VWAP from live bar data
The system SHALL expose `GET /api/vwap` which fetches today's M1 bars from the
authenticated cTrader connection, computes VWAP = Σ((H+L+C)/3 × V) / ΣV, and
returns `{ vwap: number, barsUsed: number, asOf: string }`.

#### Scenario: Successful VWAP calculation
- **WHEN** `GET /api/vwap` is called and the cTrader feed is authenticated and connected
- **THEN** the endpoint returns HTTP 200 with `{ vwap: <number>, barsUsed: <number>, asOf: <ISO-8601 string> }`

#### Scenario: Feed not connected
- **WHEN** `GET /api/vwap` is called and the cTrader feed is not connected or not authenticated
- **THEN** the endpoint returns HTTP 503 with `{ error: "feed not connected" }`

#### Scenario: All bars have zero volume
- **WHEN** `GET /api/vwap` is called and all returned bars have `volume: 0`
- **THEN** the endpoint returns HTTP 200 with VWAP computed as a simple typical-price average and `volumeWarning: true` in the response

#### Scenario: No bars returned
- **WHEN** `GET /api/vwap` is called but the cTrader API returns zero bars for the day
- **THEN** the endpoint returns HTTP 503 with `{ error: "no bars available" }`

#### Scenario: Bar request timeout
- **WHEN** `GET /api/vwap` is called and no `GET_TRENDBAR_RES` response is received within 10 seconds
- **THEN** the endpoint returns HTTP 503 with `{ error: "bar request timed out" }`

### Requirement: CTraderPriceFeed exposes getTodayBars()
`CTraderPriceFeed` SHALL implement `getTodayBars(): Promise<OhlcvBar[]>` which
sends `ProtoOAGetTrendbarsReq` (payloadType 2137) for PERIOD_M1 bars from
00:00:00 UTC today to now on the existing authenticated WebSocket connection,
correlating the reply via `clientMsgId`.

#### Scenario: Successful bar fetch
- **WHEN** `getTodayBars()` is called on a connected feed
- **THEN** it resolves with an array of OHLCV bar objects covering 00:00:00 UTC today to now

#### Scenario: Error response from API
- **WHEN** the cTrader API responds with `ERROR_RES` (payloadType 2142) for the bar request
- **THEN** `getTodayBars()` rejects with an error describing the API error

#### Scenario: WebSocket drops mid-request
- **WHEN** the WebSocket disconnects while a `getTodayBars()` call is in-flight
- **THEN** `getTodayBars()` rejects after a 10-second timeout

### Requirement: Calculate button in setup form
The setup form SHALL display a **Calculate** button to the right of the VWAP value
input using the existing `input-with-btn` wrapper and `.quick-fill-btn` class.

#### Scenario: Button click triggers fetch and populates field
- **WHEN** the analyst clicks the Calculate button
- **THEN** the button shows a spinner/disabled state, `GET /api/vwap` is called, and on
  success the VWAP input is populated with the returned value and "Updated at" reflects the current time

#### Scenario: Fetch fails
- **WHEN** the analyst clicks the Calculate button and the fetch returns a non-200 response
- **THEN** an inline error message is shown below the field and the button is re-enabled

#### Scenario: Button disabled during fetch
- **WHEN** a VWAP fetch is in progress
- **THEN** the Calculate button is disabled and shows "…" until the fetch completes or fails

#### Scenario: MockPriceFeed active
- **WHEN** `GET /api/vwap` is called while the MockPriceFeed is active (not cTrader)
- **THEN** the endpoint returns HTTP 503 with `{ error: "feed not connected" }`
