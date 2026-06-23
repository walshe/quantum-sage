## Context

The engine's `CTraderOrderExecutor` currently creates a `CTraderSession` directly in its constructor, making the broker transport impossible to replace without a real cTrader endpoint. The existing `simulate-trade.ts` script bypasses execution entirely (`auto_execute=false`) and drives only the price feed side. There is no automated way to run the full pipeline — setup → price ticks → order placement → broker fill confirmation → UI events — without a live Pepperstone connection.

Playwright is not yet a project dependency. The acceptance runner will be a standalone TypeScript script (not a vitest suite) because it starts a subprocess, drives HTTP endpoints, and captures screenshots — workload that does not fit vitest's model.

## Goals / Non-Goals

**Goals:**
- Extract `IBrokerSession` so `CTraderOrderExecutor` is testable without a real TCP connection
- `MockBrokerSession` auto-confirms market orders and position closes; keeps `liveBalanceEur` stable via a fake account update
- Engine subprocess starts with `MOCK_BROKER=true`; production code path is unchanged
- Scenario library covers the main engine state machine branches
- Runner captures before/after Playwright screenshots and asserts final `/api/state`
- `npm run acceptance` runs everything end-to-end; output saved to `acceptance-results/`

**Non-Goals:**
- Pixel-level visual regression / baseline comparison (screenshots are for human eyeballing)
- Unit testing `MockBrokerSession` itself (it's a test double, not production code)
- Testing the AI extraction pipeline (that's covered by promptfoo evals)
- Running in CI (too heavyweight; this is a pre-release sanity check)

## Decisions

### D1: Extract IBrokerSession interface, inject via constructor

**Decision:** Add `IBrokerSession` to `src/trader/IBrokerSession.ts`. Change `CTraderOrderExecutor` constructor signature to `(cfg, qsConfig, seedBalanceEur?, session?: IBrokerSession)` — if `session` is omitted the constructor builds a real `CTraderSession` as before.

**Alternatives considered:**
- *Full TCP mock server*: High fidelity but requires implementing the cTrader protobuf protocol. Disproportionate effort for the gain.
- *Monkey-patching in tests*: Brittle, not type-safe.
- *Env-var–only switch in index.ts, no interface*: Would require the mock to live in `index.ts` and bypass type safety entirely.

**Rationale:** Interface injection is the minimal change that lets tests pass a mock without touching the production call sites. The optional `session` param means all existing callers (including `index.ts`) require zero changes unless they want to inject a mock.

### D2: MockBrokerSession auto-confirms synchronously (in-process delay)

**Decision:** When `send()` is called with `PT.NEW_ORDER_REQ`, `MockBrokerSession` immediately schedules a fake `EXECUTION_EVENT` payload on `setImmediate` (gives the send() caller time to return before the fill arrives, matching real-world async behaviour). Position ID is a monotonically incrementing integer.

For `PT.CLOSE_POSITION_REQ`, it fires a `POSITION_CHANGED` / `ORDER_FILLED` pair to confirm the close.

**Alternatives considered:**
- *Configurable delay*: Adds complexity with no practical benefit for acceptance tests.
- *Manual trigger via HTTP endpoint*: More realistic but requires the runner to call a second endpoint per order, complicating the scenario DSL.

### D3: MOCK_BROKER env var in index.ts, not a config.yaml field

**Decision:** `MOCK_BROKER=true` is an env var read only in `index.ts` startup. It is not part of `QSConfig` and is never written to `config.yaml`.

**Rationale:** It is a dev/test affordance, not operator configuration. Keeping it in env prevents it from accidentally appearing in production config files.

### D4: Acceptance runner is a standalone TypeScript script, not a vitest suite

**Decision:** `acceptance-tests/runner.ts` is executed via `tsx` (already a dev dep). It manages its own engine subprocess lifecycle, HTTP calls, and Playwright session.

**Alternatives considered:**
- *vitest integration tests*: vitest is not designed to manage long-lived subprocesses or browsers. Possible but awkward.
- *Jest + jest-circus*: Adds a second test framework.

### D5: Scenarios as TypeScript files, not YAML

**Decision:** Each scenario is a `.ts` file exporting a typed `Scenario` object. The runner imports them all at startup.

**Rationale:** TypeScript gives us autocomplete, type checking on setup fields, and lets scenarios share helper functions without a separate YAML parser.

### D6: Playwright screenshot timing — wait for WebSocket event via DOM

**Decision:** After each price injection that is expected to change engine state, the runner calls a Playwright `waitForFunction` that polls `window.__QS_LAST_EVENT_TYPE__` (a global the frontend JS sets on each WebSocket message). This avoids arbitrary `sleep()` and is resilient to slow CI machines.

**Alternatives considered:**
- *Fixed sleep*: Fragile on slow machines.
- *Poll `/api/state` then screenshot*: State may be updated before the UI re-renders; screenshots could be stale.

## Risks / Trade-offs

- **Subprocess startup race** → The runner polls `GET /api/state` until it returns 200 (max 15s timeout) before starting any scenario. Same pattern as `simulate-trade.ts`.
- **MockBrokerSession diverges from real broker** → The mock only handles `NEW_ORDER_REQ` and `CLOSE_POSITION_REQ`. If the real broker adds new message types that `CTraderOrderExecutor` starts using, the mock will silently ignore them. Acceptable because the mock's job is correctness testing of the engine state machine, not broker protocol fidelity.
- **Playwright flakiness on WebSocket timing** → Mitigated by D6 (DOM polling). If a scenario has no UI event (e.g., DVS-blocked — no trade fires), the runner skips the wait and screenshots immediately after the HTTP assert.
- **`acceptance-results/` disk accumulation** → Each run creates a timestamped directory. The runner prints a reminder to clean old runs; no automatic pruning (keep it simple).

## Migration Plan

1. Extract `IBrokerSession` — no behaviour change, all existing code keeps working
2. Update `CTraderOrderExecutor` constructor — optional `session` param, defaults to building real session
3. Add `MockBrokerSession`
4. Wire env var in `index.ts`
5. Add Playwright dev dep (`npm install -D playwright` + `npx playwright install chromium`)
6. Add scenario library + runner
7. Add `npm run acceptance` to `package.json`
8. Add `acceptance-results/` to `.gitignore`

## Open Questions

- None — design is fully resolved from the explore session.
