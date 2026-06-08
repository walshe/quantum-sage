## Context

Trident's engine (`TridentEngine`) is event-driven: it watches a price feed and fires events (`ENTRY_TRIGGERED`, `BREAKEVEN_TRIGGERED`, `POSITION_CLOSED`, etc.) through the `Notifier` chain to the UI. The UI reflects these events in real time via WebSocket.

Currently the only way to see the full UI flow is to run against a live broker with a real price feed. This blocks UI review and demo preparation.

The engine already supports a mock price feed path — `TridentEngine` accepts any `PriceFeed` implementation. A simulation script can substitute a synthetic feed that emits prices at scripted intervals to drive the engine through a predetermined scenario.

## Goals / Non-Goals

**Goals:**
- Walk the engine through: setup loaded → watching → Entry 1 → Entry 2 → Entry 3 → breakeven → close at VWAP
- Fire real engine events so the full UI (live log, status panel, open position, account chip) responds exactly as in production
- No cTrader connection required — runs standalone against localhost:3000
- Configurable step delay (default 2s) so a human can follow along in the browser
- Single npm script: `npm run simulate`

**Non-Goals:**
- No changes to engine logic, UI, or production code paths
- No persistent simulation state
- No auto-execution (advisory mode only during simulation)
- Not a full regression harness — this is a demo/review tool, not a test suite

## Decisions

**1. Approach: HTTP price injection endpoint vs standalone script**

The engine exposes a WebSocket event bus but doesn't have a REST endpoint for injecting prices. Two options:

- **Option A**: Add a dev-only `/simulate/price` endpoint to the running web server that accepts synthetic ticks
- **Option B**: Run the engine in a separate process that uses a mock `PriceFeed` and a mock `CTraderTrader`

Chosen: **Option A** — add a `/simulate` HTTP endpoint to the running server (dev-only, gated by `NODE_ENV !== 'production'`). The simulation script calls this endpoint at timed intervals. This way the real browser connects to the real server and sees events naturally.

**Why**: Option B requires duplicating server setup. Option A lets the real UI observe real events from the real server — which is exactly what we want to validate.

**2. Mock account data**

The account chip shows balance/equity from `CTraderTrader`. During simulation there is no trader connection, so the server seeds account state from `CTRADER_ACCOUNT_BALANCE` / `CTRADER_ACCOUNT_CURRENCY` env vars (already implemented). The simulation script can inject `ACCOUNT_UPDATE` events via the same `/simulate` endpoint to show P&L changing as the position moves.

**3. Setup file**

The simulation writes a real YAML setup file to the `setups/` directory. The `SignalLoader` watches that directory and picks it up — this is exactly the production path. No special handling needed.

**4. Price step sequence**

The script walks through these synthetic price steps:
1. Price idles near the long Entry 1 level (watching state)
2. Price drops to Entry 1 → engine fires `ENTRY_TRIGGERED` (fill 1)
3. Price drops to Entry 2 (mid) → engine fires `ENTRY_TRIGGERED` (fill 2)
4. Price drops to Entry 3 (BUY OUTER) → engine fires `ENTRY_TRIGGERED` (fill 3)
5. Price rises 25pts from avg entry → engine fires `BREAKEVEN_TRIGGERED`
6. Price rises to VWAP → engine fires `POSITION_CLOSED`

## Risks / Trade-offs

- [Race condition] The SignalLoader has a file-system debounce. If the setup file is written and prices are injected immediately, the engine may not have loaded the setup yet. → Mitigation: the script waits for a `/simulate/ready` confirmation from the server before starting the price sequence.
- [Dev-only endpoint in prod] The `/simulate` endpoint must be strictly gated to non-production environments. → Mitigation: guard with `if (process.env.NODE_ENV === 'production') return 404`.
- [Auto-execute interference] If `auto_execute: true` is set in config.yaml, the simulation will attempt to place real broker orders. → Mitigation: the script documents this clearly and the endpoint rejects simulation requests if `auto_execute` is enabled.
