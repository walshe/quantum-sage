## Why

The engine is purely advisory today — it fires `ENTRY_TRIGGERED`, `BREAKEVEN_TRIGGERED`, and `POSITION_CLOSED` events and the analyst places the orders manually at the broker. This creates execution risk: delays between signal and fill, and the possibility of missing a trigger entirely. Automating execution via the cTrader Open API removes that risk and makes the system self-contained.

## What Changes

- **New**: An order executor wired into the engine's notifier chain that places market orders at the broker when entries trigger, updates the stop-loss order when breakeven activates or stop recalculates, and closes the full position when the engine decides to exit.
- **New**: The executor uses a dedicated `CTraderSession` (independent from the price feed and balance sessions — consistent with the C2 architecture already in place).
- **Enhancement**: The live P&L (`unrealizedPnl`) already fetched by `CTraderTrader` is surfaced in the Open Position panel in the UI so the analyst can see the broker-reported floating gain/loss in real time.
- **Config**: A new `auto_execute` boolean flag in `config.yaml` (default `false`) gates execution — the system remains advisory unless the operator opts in. Useful for running in shadow mode before going live.

## Capabilities

### New Capabilities
- `ctrader-order-execution`: Places market orders at broker entry triggers, adjusts stop-loss orders on breakeven/stop recalc, and closes the full position on exit. Owns its own `CTraderSession` and sits on the `MultiNotifier` as an optional child.

### Modified Capabilities
- `account-balance-ui`: Extend the existing Open Position panel to show live `unrealizedPnl` (already available from `CTraderTrader` via the bootstrap/account-update events) alongside the existing avg entry, stop, and target fields.

## Impact

- `src/trader/` — new `CTraderOrderExecutor.ts` module
- `src/notifier/Notifier.ts` — no change (executor listens to existing events)
- `src/index.ts` — wire executor into `MultiNotifier` when `auto_execute: true`
- `config.yaml` + `src/config/types.ts` — add `auto_execute` flag
- `src/web/public/app.js` + `index.html` — render `unrealizedPnl` in position panel
- `docker-compose.yml` / `.env` — no new env vars needed (shares cTrader credentials)
- New dependency: none (cTrader Open API already used by price feed and balance)
