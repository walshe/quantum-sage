## Context

`CTraderSession` (merged in PR #10) provides an authenticated WebSocket connection with a `send()` / `onMessage()` registry. `CTraderTrader` will be the second consumer of this pattern. The cTrader Open API exposes account details — balance, equity, unrealized PnL — via `ProtoOATraderReq` (payloadType 2120) / `ProtoOATraderRes` (payloadType 2121). These are already defined in `PT` in `CTraderSession.ts`.

The existing notifier pipeline (engine → Notifier → WebSocketNotifier → browser) is the correct channel for pushing account data to the UI — using it avoids a second WebSocket or REST polling from the browser.

## Goals / Non-Goals

**Goals:**
- `CTraderTrader` connects to cTrader, fetches balance + equity after auth, refreshes every 30 seconds
- Balance and unrealized PnL (equity − balance) flow to the UI via the existing notifier pipeline
- New `balance` chip and `unrealizedPnl` display in the status band
- `Bootstrap.account` is populated on connect so late-joining browser tabs see current values immediately

**Non-Goals:**
- Order placement (next change after this)
- Historical / realized PnL (separate API call, separate change)
- Position sizing calculations (follows from live balance)
- Currency conversion (balance is in account currency — display as-is)

## Decisions

### 1. CTraderTrader owns its own CTraderSession (C2)

Same decision as the price feed — independent connection, independent reconnect. If the price feed drops, balance data continues. If the trader drops, prices continue.

### 2. Poll TRADER_REQ every 30 seconds

The unrealized PnL changes with every tick, but fetching it from the API on every tick would be wasteful. 30 seconds is a reasonable staleness for an informational display. A future change can tighten this once auto-execution makes PnL accuracy critical.

Alternative considered: subscribe to `ProtoOASpotEvent` on the trader session and recompute PnL locally — over-engineering for a display-only feature.

### 3. Route account data through the existing notifier, not a new channel

The UI already has a WebSocket connection and a bootstrap/event pipeline. Adding `Bootstrap.account` and an `ACCOUNT_UPDATE` event reuses all of that infrastructure. No new REST endpoint, no second WS connection from the browser.

### 4. `Bootstrap.account` is optional (`| null`)

When `CTraderTrader` is not configured (e.g. `--mock` mode, or credentials missing), `account` is `null`. The UI shows nothing for the balance chip in that case — graceful degradation, no errors.

### 5. TRADER_RES integer decoding

cTrader sends `balance` and `equity` as integers. The `moneyDigits` field in the response specifies decimal places (typically 2). Divide by `10 ** moneyDigits`. The currency name comes from a separate field; if absent, default to `"EUR"` (FB's account currency per the PRD).

## Risks / Trade-offs

- **Risk: TRADER_RES field names differ from docs** → Mitigation: log the raw response on first connect so we can see the actual shape. The design notes field names from the public proto spec but they should be verified against the live JSON port.
- **Risk: demo server quirks** → The same `noHeartbeat` / `symbolId` workarounds that exist in the price feed apply here too. `CTraderSession` handles the heartbeat rejection already.
- **Risk: 30s poll accumulates bar request timeouts if the connection drops** → Mitigation: check that the session is still connected before polling; skip the poll if not.

## Migration Plan

1. Create `CTraderTrader` — connect, fetch, poll, emit events
2. Extend `Bootstrap` and `ACCOUNT_UPDATE` event type — backward-compatible
3. Wire `CTraderTrader` into `index.ts`
4. Add UI chips — balance and unrealizedPnl
5. Run tests, verify visually on demo server
