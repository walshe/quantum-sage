## Context

`CTraderPriceFeed` (~750 lines) is a monolith that handles two distinct concerns: (1) WebSocket lifecycle, app/account authentication, heartbeat, and token refresh — all of which are broker-level plumbing — and (2) symbol resolution, spot subscription, and OHLCV bar fetching — which are price-feed concerns. The upcoming `CTraderTrader` needs concern (1) but not concern (2). Without a shared base, that auth plumbing would have to be duplicated.

The existing code is well-tested indirectly through integration (the price feed works in production). The refactor must not break any observable behaviour.

## Goals / Non-Goals

**Goals:**
- Extract a `CTraderSession` class that owns the WebSocket, the 3-step auth handshake (app → accounts → account), heartbeat, and token refresh
- `CTraderSession` exposes a typed `onMessage(payloadType, handler)` registry and a `send()` method
- `CTraderPriceFeed` is refactored to own a `CTraderSession` internally and register its own handlers — external interface unchanged
- All existing tests pass without modification
- `CTraderSession` is ready to be used by `CTraderTrader` in the next PR

**Non-Goals:**
- Sharing a single session instance between PriceFeed and Trader (Option C2: each gets its own)
- Any new user-visible behaviour
- `CTraderTrader` itself (next PR)
- Changes to `MockPriceFeed`, `PriceFeed` interface, or any caller

## Decisions

### 1. Handler registry over subclassing

`CTraderSession` uses a `Map<payloadType, handler>` rather than abstract methods or events. Consumers call `session.onMessage(PT.SPOT_EVENT, handler)` at startup.

**Why:** Avoids inheritance (fragile base class problem), keeps consumers fully in charge of their own payload types, and makes it easy to add a second consumer without touching `CTraderSession`.

Alternatives considered:
- *Subclass with abstract methods* — couples session to the consumer's payload types; would need a different subclass per consumer
- *EventEmitter* — works, but leaks all payload types to all listeners; `onMessage` is explicit and easier to test

### 2. C2: each consumer owns its own session instance

`CTraderPriceFeed` creates a `CTraderSession` internally. `CTraderTrader` (next PR) will create a separate one. Two WebSocket connections, two auth handshakes.

**Why:** Independent reconnect. If the price feed drops, position management continues (and vice versa). For a financial system this isolation is worth the extra connection overhead.

Alternatives considered:
- *Shared session* — simpler, but one socket failure takes down both price feed and order management simultaneously

### 3. `CTraderSession` is not exposed in the public API

`CTraderPriceFeed`'s constructor signature stays unchanged. `CTraderSession` is an internal implementation detail, not exported from `providers/index.ts`. Callers (i.e. `src/index.ts`) see no change.

**Why:** Keeps the change non-breaking and minimal in scope. If we later want to inject a shared session for testing, we can add an optional constructor overload then.

### 4. Config split: session config vs feed config

`CTraderSession` takes a subset of the current `CTraderPriceFeedConfig` — the fields it actually needs: `clientId`, `clientSecret`, `accessToken`, `accountId`, `wsUrl`, `noHeartbeat`, `refreshToken`, `tokenExpiresAt`, `onTokenRefresh`.

`CTraderPriceFeed` keeps the full config (adding `symbolName`, `symbolId`) and passes the session-relevant slice to its `CTraderSession`.

## Risks / Trade-offs

- **Risk: behaviour regression in the handshake** → Mitigation: the handshake logic moves verbatim — no logic changes, only structural ones. Existing tests cover the live path; add a unit test for `CTraderSession` auth flow with a mock WS.
- **Risk: two connections surprise** → Mitigation: document clearly in the mental notes that two separate sessions are intentional (C2 decision).
- **Risk: demo server quirks** → The `noHeartbeat` and `symbolId` workarounds already exist; they stay in place.

## Migration Plan

1. Create `CTraderSession` with the extracted auth/WS logic
2. Refactor `CTraderPriceFeed` to delegate to it — keeping the same external interface
3. Run full test suite — no failures expected
4. No deployment changes needed (`CTraderPriceFeedConfig` shape is unchanged)
