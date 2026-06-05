## Context

The engine fires `ENTRY_TRIGGERED`, `BREAKEVEN_TRIGGERED`, and `POSITION_CLOSED` events into the `MultiNotifier` chain. Today only `ConsoleNotifier`, `LoggerNotifier`, and `WebSocketNotifier` sit on that chain — all read-only. The cTrader session infrastructure (`CTraderSession`) already handles auth, WebSocket lifecycle, and message correlation; `CTraderPriceFeed` and `CTraderTrader` each own a dedicated session (C2 pattern). No order-placement code exists yet.

The cTrader Open API accepts orders via `ProtoOANewOrderReq`, allows position-level SL/TP amendment via `ProtoOAAmendPositionSLTPReq`, and closes via `ProtoOAClosePositionReq`. All of these return execution events (`ProtoOAExecutionEvent`, payloadType 2126) that carry the resulting `positionId`. Payload types need to be confirmed from the public `.proto` definitions on the first real run (same pattern as the bar-fetch implementation).

The position-sizing formula is currently deferred (mental notes: "implement static config first"). Execution requires a concrete lot count, so this change must implement the formula as a prerequisite.

## Goals / Non-Goals

**Goals:**
- Place market orders at the broker when the engine fires entry triggers
- Track the broker-side `positionId` so SL and close requests target the right position
- Move the stop-loss order at the broker when breakeven activates or a subsequent entry recalculates the stop
- Close the full broker position when the engine fires `POSITION_CLOSED`
- Compute lot counts from config (`point_value_eur`, `starting_capital_eur`, `daily_risk_pct`, allocation %, `stop_loss_points`)
- Gate all execution behind `auto_execute: true` in `config.yaml` — default `false`
- Surface `unrealizedPnl` from `CTraderTrader` in the Open Position panel (already fetched, just not displayed there)

**Non-Goals:**
- Partial fills / order splitting — one market order per entry trigger
- Limit or stop-entry orders — market only for Phase 2
- Reconnect replay of missed events — if the executor is disconnected when a trigger fires, it logs the failure; the analyst falls back to manual
- Trading on live (non-demo) accounts in this change — demo only until explicitly enabled by a separate config flag
- Trailing stops

## Decisions

### Decision: Executor as a Notifier, not a service
The executor implements the `Notifier` interface and is appended to `MultiNotifier` in `index.ts` when `auto_execute: true`. This gives it the same event bus as every other output channel without touching the engine or the notifier interface.

**Alternative considered:** A separate callback hook on `TridentEngine` — rejected because it couples the engine to execution concerns. The notifier pattern is already the correct extension point.

### Decision: Dedicated CTraderSession (C3)
The executor gets its own `CTraderSession` — independent from the price feed (C1) and balance poller (C2). If order placement is temporarily unavailable, neither the price stream nor the balance poll is affected.

**Alternative considered:** Reusing the price feed session — rejected for the same reason C2 was separated from C1: fault isolation in a financial system.

### Decision: Market orders only for Phase 2
When an entry triggers, the engine has already decided the trigger price. A market order executes at the best available price at that moment, which is at or very close to the trigger. A limit order at the exact trigger price risks missing the fill if the market moves away instantly.

**Alternative considered:** Limit orders at the trigger price — deferred; may be revisited if slippage is observed to be material.

### Decision: SL managed via ProtoOAAmendPositionSLTPReq (position-level)
After the first fill, the executor sets a stop-loss on the `positionId` using `ProtoOAAmendPositionSLTPReq`. Subsequent entries or breakeven events call the same amend — no separate stop order to track.

**Alternative considered:** A dedicated stop-order (`orderType: STOP`) — rejected because managing an order-level stop alongside a position requires coordinating two objects. Position-level SL is simpler and is the pattern cTrader supports natively.

### Decision: Volume computation in executor
Lot count = `floor((capital × daily_risk_pct/100 × alloc_pct/100) / (stop_loss_points × point_value_eur))`. This lives in a new `computeVolume()` pure function in the executor module. `point_value_eur` is a new required config field.

**Alternative considered:** Computing volume inside `TridentEngine` — rejected because the engine is purely advisory; volume is an execution concern.

### Decision: Loud failure, no state rollback
If an order request is rejected by the broker (e.g. insufficient margin, session drop), the executor logs an `error`-level structured entry and emits an `ORDER_FAILED` notification event over the WebSocket so the analyst sees it immediately in the live log. The engine's internal state is NOT rolled back — the analyst must intervene manually.

**Alternative considered:** Reverting engine state on failure — too complex and error-prone for an MVP; deferred.

### Decision: auto_execute gate in config.yaml
`auto_execute: false` is the default. The executor is not even instantiated unless it is `true`. This makes the shadow/advisory mode the safe default and requires a deliberate operator action to enable live orders.

## Risks / Trade-offs

- **Slippage risk** — market orders at trigger price may fill a few points away in fast markets. The stop is still set from the engine's `stop_loss_points` off avg entry, which already accounts for this somewhat. Mitigation: monitor slippage in logs; consider limit orders in a follow-up.

- **Execution event ordering** — the executor needs the `positionId` from the first execution event before it can amend the SL on the second entry. If entry 2 triggers before the execution event for entry 1 is received, the SL amend races. Mitigation: executor queues SL amend requests; the next received execution event triggers a flush.

- **Session disconnect during a trade** — if the executor's session drops while a position is open, subsequent engine events (BREAKEVEN, CLOSE) won't reach the broker. Mitigation: the existing reconnect pattern re-establishes the session; after reconnect, a reconciliation step reads the open position from the broker and re-attaches. This reconciliation is deferred for MVP — log the disconnect prominently and require analyst intervention.

- **Demo vs live credentials** — cTrader uses different endpoints and account IDs for demo and live. Mixing them causes real money risk. Mitigation: in this change the executor always uses the demo endpoint (`CTRADER_WS_URL`); a separate live-execution config flag and credentials review are gated behind a future change.

- **Volume misconfiguration** — if `point_value_eur` is wrong, lot sizes will be incorrect. Mitigation: on startup log the computed lot count for the current config so the operator can verify before trading starts.

## Migration Plan

1. Add `point_value_eur` and `auto_execute` to `config.yaml` schema + loader (loader throws if `auto_execute: true` and `point_value_eur` is missing).
2. Implement `CTraderOrderExecutor` with `auto_execute: false` in `config.yaml` — existing operators see no change.
3. Wire into `index.ts`, test in shadow mode (executor instantiated but `auto_execute: false` in config → executor not created, fully inert).
4. Set `auto_execute: true` on demo environment and test end-to-end with a demo account.
5. Roll to production only after demo validation.

**Rollback:** set `auto_execute: false` (or remove the key) in `config.yaml` and restart — the executor is never instantiated. No code change required.

## Open Questions

- What is the exact `volumeInLots` unit cTrader expects — integer lots, or does the API accept fractional? Confirm from API docs / first test send.
- Does `ProtoOAAmendPositionSLTPReq` require the stop in absolute price, or as a distance? Confirm from `.proto` definitions.
- Is there a minimum order volume for the US500 instrument on the demo account? The volume formula may produce 0 at small capital — loader should guard against this.
