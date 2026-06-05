## ADDED Requirements

### Requirement: auto_execute config flag gates all order placement
`config.yaml` SHALL include an `auto_execute` boolean field (default `false`). `CTraderOrderExecutor` SHALL only be instantiated in `index.ts` when `auto_execute: true`. When `false` or absent, the system behaves identically to today — purely advisory.

#### Scenario: auto_execute false — no executor created
- **WHEN** `config.yaml` has `auto_execute: false` or omits the field
- **THEN** `CTraderOrderExecutor` is not instantiated and no orders are sent to the broker

#### Scenario: auto_execute true — executor wired into notifier chain
- **WHEN** `config.yaml` has `auto_execute: true`
- **THEN** `CTraderOrderExecutor` is appended to `MultiNotifier` and receives all engine events

### Requirement: point_value_eur required when auto_execute is true
`config.yaml` SHALL include a `point_value_eur` number field when `auto_execute: true`. The config loader SHALL throw at startup if `auto_execute: true` and `point_value_eur` is missing or zero.

#### Scenario: Missing point_value_eur with auto_execute true
- **WHEN** `auto_execute: true` and `point_value_eur` is absent or 0
- **THEN** the process throws a config validation error at startup and exits

#### Scenario: point_value_eur present — startup logs computed volume
- **WHEN** the executor starts with valid config
- **THEN** it logs the computed lot count per entry tier at INFO level so the operator can verify sizing before trading begins

### Requirement: CTraderOrderExecutor owns its own CTraderSession
`CTraderOrderExecutor` SHALL create and manage its own `CTraderSession` instance, independent from the price feed and balance sessions. It SHALL connect using the same credentials and `connectWithRetry` pattern as the other sessions.

#### Scenario: Executor connects independently
- **WHEN** `CTraderOrderExecutor.connect()` is called
- **THEN** it authenticates via its own `CTraderSession` without affecting the price feed or balance session

#### Scenario: Executor session drop does not affect price feed
- **WHEN** the executor's session disconnects
- **THEN** price ticks continue to arrive and the engine continues to process them

### Requirement: Volume computed from config at entry time
The executor SHALL compute lot count as `floor((starting_capital_eur × daily_risk_pct/100 × alloc_pct/100) / (stop_loss_points × point_value_eur))`. The `alloc_pct` comes from the `ENTRY_TRIGGERED` event payload. If the computed volume is 0, the executor SHALL skip the order, log an error, and emit an `ORDER_FAILED` notification.

#### Scenario: Volume computed correctly for entry 1 at 32.5% allocation
- **WHEN** an `ENTRY_TRIGGERED` event fires for entry 1 with `alloc: 32.5`
- **THEN** `volume = floor((capital × 0.005 × 0.325) / (stop_points × point_value_eur))`

#### Scenario: Volume of 0 skips the order
- **WHEN** the computed volume rounds down to 0
- **THEN** no order is sent and an `ORDER_FAILED` event is emitted with reason "computed volume is zero"

### Requirement: Market order placed on ENTRY_TRIGGERED
On receiving `ENTRY_TRIGGERED`, the executor SHALL send `ProtoOANewOrderReq` with `orderType: MARKET` and the computed volume for that entry's allocation. The order direction SHALL match the position direction in the event payload.

#### Scenario: Long entry 1 triggers a market buy
- **WHEN** `ENTRY_TRIGGERED` fires with `direction: "long"`, `entryNum: 1`
- **THEN** executor sends a MARKET BUY order for the computed volume

#### Scenario: Short entry 2 triggers a market sell
- **WHEN** `ENTRY_TRIGGERED` fires with `direction: "short"`, `entryNum: 2`
- **THEN** executor sends a MARKET SELL order for the computed volume at entry 2's allocation %

### Requirement: positionId captured from execution event
After a market order fills, the broker sends `ProtoOAExecutionEvent`. The executor SHALL extract and store the `positionId` from this event. The stored `positionId` is used for all subsequent SL amendments and the final close request.

#### Scenario: positionId stored after first fill
- **WHEN** `ProtoOAExecutionEvent` arrives with `executionType: ORDER_FILLED`
- **THEN** executor stores `positionId` and logs it at DEBUG level

#### Scenario: Subsequent entries add to the same position
- **WHEN** a second or third market order fills
- **THEN** the execution event confirms the same `positionId`; executor updates its stored value

### Requirement: Stop-loss set on the position after first fill
After the `positionId` is known, the executor SHALL send `ProtoOAAmendPositionSLTPReq` with the stop price from the engine's `ENTRY_TRIGGERED` event payload (`stopPrice`). This sets the broker-side stop-loss.

#### Scenario: SL set after entry 1 fills
- **WHEN** the first `ProtoOAExecutionEvent` arrives with a `positionId`
- **THEN** executor immediately sends `ProtoOAAmendPositionSLTPReq` with `stopLoss` = `stopPrice` from the ENTRY_TRIGGERED payload

### Requirement: Stop-loss amended on BREAKEVEN_TRIGGERED and subsequent fills
On `BREAKEVEN_TRIGGERED` or any `ENTRY_TRIGGERED` after the first (which recalculates the stop), the executor SHALL send `ProtoOAAmendPositionSLTPReq` with the updated `stopPrice`.

#### Scenario: Breakeven moves the broker stop
- **WHEN** `BREAKEVEN_TRIGGERED` fires with a new `stopPrice`
- **THEN** executor sends `ProtoOAAmendPositionSLTPReq` with the new stop price

#### Scenario: Entry 2 fill recalculates stop
- **WHEN** `ENTRY_TRIGGERED` fires for entry 2 or 3 with a recalculated `stopPrice`
- **THEN** executor sends `ProtoOAAmendPositionSLTPReq` with the new stop price after the fill event arrives

### Requirement: Position closed on POSITION_CLOSED
On `POSITION_CLOSED`, the executor SHALL send `ProtoOAClosePositionReq` for the stored `positionId` with the full volume. If no `positionId` is stored (position was never opened at the broker), the executor SHALL log an error and take no action.

#### Scenario: Engine closes position — broker close sent
- **WHEN** `POSITION_CLOSED` fires and a `positionId` is stored
- **THEN** executor sends `ProtoOAClosePositionReq` with the full position volume

#### Scenario: POSITION_CLOSED but no broker position opened
- **WHEN** `POSITION_CLOSED` fires and `positionId` is null
- **THEN** executor logs a warning and does not send any request

### Requirement: Order failure emits ORDER_FAILED notification
If the broker responds with an error to any order request, the executor SHALL log the error at ERROR level, emit an `ORDER_FAILED` `NotificationEvent` with the reason, and take no further automated action. The analyst must intervene manually.

#### Scenario: Broker rejects a market order
- **WHEN** the broker responds with an error payload to `ProtoOANewOrderReq`
- **THEN** executor logs the rejection, emits `ORDER_FAILED` event visible in the live log UI

#### Scenario: SL amend fails
- **WHEN** `ProtoOAAmendPositionSLTPReq` is rejected
- **THEN** executor logs ERROR and emits `ORDER_FAILED` with the rejection reason

### Requirement: Executor resets state on engine reset
When the engine fires a reset (state returns to `idle`), the executor SHALL clear its stored `positionId` and any pending SL amend queue, ready for the next trade setup.

#### Scenario: Engine reset clears executor state
- **WHEN** `POSITION_CLOSED` fires with `reason: "reset"` or the engine transitions to idle
- **THEN** executor sets `positionId = null` and clears any queued SL requests
