## 1. IBrokerSession Interface + CTraderOrderExecutor Refactor

- [x] 1.1 Create `src/trader/IBrokerSession.ts` — extract the interface (`connect`, `disconnect`, `send`, `onMessage`, `accountId`) from `CTraderSession`
- [x] 1.2 Update `CTraderOrderExecutor` constructor to accept optional `session?: IBrokerSession`; if omitted build a real `CTraderSession` as before (no change to existing callers)
- [x] 1.3 Run `npm test` — all existing tests must still pass

## 2. MockBrokerSession

- [x] 2.1 Create `src/trader/MockBrokerSession.ts` implementing `IBrokerSession`
- [x] 2.2 `connect()` / `disconnect()` are no-ops; `accountId` returns a fixed fake value (e.g. `999`)
- [x] 2.3 `onMessage()` stores handlers in a map keyed by payload type
- [x] 2.4 `send()` — on `NEW_ORDER_REQ`: schedule a fake `EXECUTION_EVENT` (POSITION_OPENED, synthetic positionId) via `setImmediate`
- [x] 2.5 `send()` — on `CLOSE_POSITION_REQ`: schedule a fake `EXECUTION_EVENT` (ORDER_FILLED) via `setImmediate`
- [x] 2.6 `send()` — on `AMEND_POSITION_SLTP_REQ`: no-op (stop loss amends don't need confirmation)

## 3. MOCK_BROKER env var wiring in index.ts

- [x] 3.1 In `index.ts`, read `process.env.MOCK_BROKER`; when `'true'` and `auto_execute` is on, construct a `MockBrokerSession` and pass it as the `session` arg to `CTraderOrderExecutor`
- [x] 3.2 Log a prominent startup warning when `MOCK_BROKER=true` so it is never silently active in production

## 4. Playwright + project setup

- [x] 4.1 `npm install -D playwright` from `trident/impl/nodejs/`
- [x] 4.2 `npx playwright install chromium` (add to README as a one-time setup step)
- [x] 4.3 Add `acceptance-results/` to `.gitignore`
- [x] 4.4 Create `acceptance-tests/` directory structure: `scenarios/`, `mock/` (empty for now — mock lives in src/), `types.ts`, `runner.ts`

## 5. Scenario types and helpers

- [x] 5.1 Create `acceptance-tests/types.ts` — define `Scenario`, `ScenarioStep`, `SetupFields`, `EngineState` types
- [x] 5.2 Create `acceptance-tests/helpers.ts` — `post(path, body)`, `getState()`, `waitForState(target, timeoutMs)`, `writeSetupYaml(scenario, dir)` shared utilities (extracted/adapted from `simulate-trade.ts`)

## 6. Scenario library

- [x] 6.1 Create `acceptance-tests/scenarios/01-long-full.ts` — long bias, all 3 entries, breakeven, VWAP close; `expectedFinalState: 'closed'`
- [x] 6.2 Create `acceptance-tests/scenarios/02-short-full.ts` — short bias mirror; `expectedFinalState: 'closed'`
- [x] 6.3 Create `acceptance-tests/scenarios/03-long-stopped-out.ts` — entry 1 fires, price falls past stop; `expectedFinalState: 'closed'`
- [x] 6.4 Create `acceptance-tests/scenarios/04-long-time-exit.ts` — entry 1 fires, time_exit fires (use `time_exit_minutes: 1` config override); `expectedFinalState: 'closed'`
- [x] 6.5 Create `acceptance-tests/scenarios/05-dvs-blocked.ts` — DVS above gate, no trade; `expectedFinalState: 'blocked'`
- [x] 6.6 Create `acceptance-tests/scenarios/06-dvs-unblock.ts` — blocked → re-submit below gate → `expectedFinalState: 'watching'`
- [x] 6.7 Create `acceptance-tests/scenarios/07-neutral-bias-long.ts` — neutral bias, price drops to long levels; `expectedFinalState: 'closed'`
- [x] 6.8 Create `acceptance-tests/scenarios/index.ts` — re-exports all scenarios as an ordered array

## 7. Acceptance runner

- [x] 7.1 Create `acceptance-tests/runner.ts` — main entry point
- [x] 7.2 Runner: start engine subprocess (`tsx src/index.ts`) with `MOCK_BROKER=true`, `NODE_ENV=test`, test setups dir
- [x] 7.3 Runner: poll `GET /api/state` until 200 (max 15s) before starting scenarios
- [x] 7.4 Runner: open Playwright Chromium browser pointing to `http://localhost:3000`; add `window.__QS_LAST_EVENT_TYPE__` tracking hook by injecting a `page.addInitScript` that patches the WebSocket `onmessage` handler
- [x] 7.5 Runner: implement scenario execution loop — reset engine, write YAML, wait for initial state, screenshot before, inject steps, screenshot after, assert final state
- [x] 7.6 Runner: for `screenshot: true` steps, capture mid-scenario screenshot to `steps/<n>-<label>.png`
- [x] 7.7 Runner: write `result.json` per scenario, `summary.json` overall; print summary table to stdout
- [x] 7.8 Runner: exit code 0 if all pass, 1 if any fail; always kill engine subprocess in finally block
- [x] 7.9 Add `"acceptance": "tsx acceptance-tests/runner.ts"` to `package.json` scripts

## 8. Documentation

- [x] 8.1 Update `README.md` — add "Acceptance Tests" section: one-time Playwright setup, `npm run acceptance`, where results land
- [x] 8.2 Update `developer-mental-notes.md` — note `MOCK_BROKER=true` env var and that acceptance tests require `auto_execute: true` in config
