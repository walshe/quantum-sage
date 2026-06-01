## Why

`CTraderPriceFeed` currently bundles WebSocket management, authentication, heartbeat, token refresh, symbol resolution, and spot-price streaming into a single class. The upcoming `CTraderTrader` (order placement + balance) needs the same authenticated connection — without a shared foundation each consumer duplicates the auth handshake and owns its own socket, making reconnect logic and token refresh harder to reason about. Extracting `CTraderSession` now gives both consumers a clean, tested base before any execution code is written.

## What Changes

- **New class `CTraderSession`** — owns the WebSocket, drives the app auth → account selection → account auth handshake, manages heartbeat and token refresh, exposes `send()` and `onMessage(payloadType, handler)` for consumers.
- **`CTraderPriceFeed` refactored** — delegates connection/auth to a `CTraderSession` instance it owns; registers its own handlers for `SYMBOL_LIST_RES`, `SUBSCRIBE_SPOTS_RES`, `SPOT_EVENT`, `GET_TRENDBAR_RES`. External `PriceFeed` interface is unchanged.
- Two separate session instances (Option C2): `CTraderPriceFeed` creates its own `CTraderSession`; the future `CTraderTrader` will create its own. No shared state between them.

## Capabilities

### New Capabilities

- `ctrader-session`: Authenticated cTrader WebSocket session — connection lifecycle, auth handshake, heartbeat, token refresh, and typed message dispatch.

### Modified Capabilities

<!-- None — the external PriceFeed interface and all callers are unchanged. -->

## Impact

- `src/price-feed/CTraderPriceFeed.ts` — refactored internally; public interface unchanged
- New `src/price-feed/CTraderSession.ts`
- No changes to `src/index.ts`, tests, or any other caller
- All existing tests must pass without modification
