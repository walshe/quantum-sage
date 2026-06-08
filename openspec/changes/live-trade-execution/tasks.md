## 1. Config changes

- [x] 1.1 Add `auto_execute: boolean` (optional, default false) and `point_value_eur: number` (required when auto_execute true) to `QSConfig` in `src/config/types.ts`
- [x] 1.2 Add validation to `src/config/loader.ts`: throw if `auto_execute: true` and `point_value_eur` is missing or zero
- [x] 1.3 Update `config.yaml` with `auto_execute: false` and a commented-out `point_value_eur` example

## 2. Notifier event types

- [x] 2.1 Add `ORDER_FAILED` to `NotificationEvent` union in `src/notifier/Notifier.ts` with fields `{ reason: string; orderId?: string }`
- [x] 2.2 Handle `ORDER_FAILED` in `ConsoleNotifier.ts` (print as error) and `WebSocketNotifier` / `eventFormatter.ts` (show in live log as error severity)

## 3. Volume computation

- [x] 3.1 Create `src/trader/volumeCalculator.ts` with a pure `computeVolume({ capital, riskPct, allocPct, stopPoints, pointValue }): number` function (returns `Math.floor(...)`)
- [x] 3.2 Write unit tests in `tests/trader/volumeCalculator.test.ts` covering normal case, zero result, and rounding

## 4. CTraderOrderExecutor

- [x] 4.1 Create `src/trader/CTraderOrderExecutor.ts` implementing `Notifier` — constructor takes `CTraderSession` config + `QSConfig`
- [x] 4.2 Implement `connect()` / `disconnect()` delegating to its own `CTraderSession`
- [x] 4.3 On connect, log computed lot counts per tier (32.5%, 35%, 32.5%) at INFO level
- [x] 4.4 Implement `notify(event)`: switch on `ENTRY_TRIGGERED` → place market order; `BREAKEVEN_TRIGGERED` → amend SL; `POSITION_CLOSED` → close position; all other events ignored
- [x] 4.5 Implement `placeMarketOrder(direction, volume)` sending `ProtoOANewOrderReq` (confirm payload type from `.proto`); return the `clientMsgId`
- [x] 4.6 Handle `ProtoOAExecutionEvent` (payloadType 2126): extract `positionId`, store it, then call `amendStopLoss(stopPrice)`
- [x] 4.7 Implement `amendStopLoss(stopPrice)` sending `ProtoOAAmendPositionSLTPReq` with stored `positionId` (queue if `positionId` not yet known)
- [x] 4.8 Implement `closePosition()` sending `ProtoOAClosePositionReq` with stored `positionId` and full volume; guard against null `positionId`
- [x] 4.9 On any broker error response: emit `ORDER_FAILED` notification event; log at ERROR level; do not retry
- [x] 4.10 On `POSITION_CLOSED` (any reason): clear stored `positionId` and SL amend queue after close request is sent

## 5. Wiring in index.ts

- [x] 5.1 When `config.autoExecute === true`, instantiate `CTraderOrderExecutor` with the cTrader session config and push it onto `MultiNotifier`
- [x] 5.2 Call `executor.connect()` with the same `connectWithRetry` pattern used for `CTraderPriceFeed` and `CTraderTrader`
- [x] 5.3 Add `executor.disconnect()` to the shutdown sequence

## 6. UI — Broker P&L in Open Position panel

- [x] 6.1 In `app.js`, read `unrealizedPnl` and `currency` from the latest account state (already in bootstrap/account_update)
- [x] 6.2 Add a `Broker P&L` row to the Open Position panel in `index.html` (hidden by default)
- [x] 6.3 Show/hide and format the row in `app.js`: green `+€X.XX` for positive, red `-€X.XX` for negative; hide when `state !== 'in_trade'` or `unrealizedPnl === 0`
- [x] 6.4 Update the row on every `account_update` WebSocket event while `state === 'in_trade'`

## 7. Tests

- [x] 7.1 Write unit tests for `CTraderOrderExecutor.notify()`: verify correct API calls emitted for `ENTRY_TRIGGERED`, `BREAKEVEN_TRIGGERED`, `POSITION_CLOSED` using a mock session
- [x] 7.2 Test `ORDER_FAILED` notification is emitted when the mock session returns an error response
- [x] 7.3 Test that the executor is not instantiated when `auto_execute: false` (integration test in `index.ts` wiring or config loader test)

## 8. Documentation

- [x] 8.1 Update `developer-mental-notes.md`: document `CTraderOrderExecutor` architecture, the C3 session pattern, and the volume formula
- [x] 8.2 Update `ARCHITECTURE.md`: advance the phase description to note Phase 2 (auto-execution) is now implemented
- [x] 8.3 Update `trident/docs/PRD.md`: document `auto_execute` config flag and execution behaviour
- [x] 8.4 Update `RUNNING.md`: add `auto_execute` and `point_value_eur` to the operator config reference
