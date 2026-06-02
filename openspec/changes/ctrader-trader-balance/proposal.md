## Why

With `CTraderSession` now extracted (PR #10), the session layer is ready to host a second consumer. The analyst needs to see the live demo account balance and the unrealized PnL of any open position directly in the dashboard — without switching to the broker platform. This is the foundation for position sizing from live equity (Phase 2 auto-execution).

## What Changes

- **New class `CTraderTrader`** — owns its own `CTraderSession` (C2 design), connects to the same demo endpoint as the price feed, fetches account balance and equity via `ProtoOATraderReq` (payloadType 2120) after auth, and refreshes on a periodic poll.
- **`index.ts`** — creates `CTraderTrader` alongside the price feed when cTrader credentials are present; wires balance/equity updates into the notifier.
- **`Bootstrap`** — gains an optional `account` field: `{ balance, equity, unrealizedPnl, currency } | null`. Null when no trader is configured.
- **New notifier event `ACCOUNT_UPDATE`** — emitted by `CTraderTrader` when balance or equity changes, carries the same shape as `Bootstrap.account`.
- **UI status band** — new `balance` chip showing live account balance; `unrealizedPnl` shown beside it when non-zero (formatted with sign and colour).

## Capabilities

### New Capabilities

- `ctrader-trader`: Authenticated cTrader trader session — connects, fetches account balance and equity, refreshes periodically, emits ACCOUNT_UPDATE events.
- `account-balance-ui`: Dashboard status band displays live demo account balance and unrealized PnL near the price chip.

### Modified Capabilities

<!-- Bootstrap gains an optional account field — existing clients that don't read it are unaffected. -->

## Impact

- New `src/trader/CTraderTrader.ts`
- `src/notifier/WebSocketNotifier.ts` — `Bootstrap.account` field added (optional, backward-compatible)
- `src/notifier/Notifier.ts` — new `ACCOUNT_UPDATE` event type
- `src/index.ts` — create and connect `CTraderTrader`
- `src/web/public/index.html` + `app.js` + `styles.css` — balance and PnL chips
- No changes to `CTraderSession`, `CTraderPriceFeed`, `TridentEngine`, or any existing tests
