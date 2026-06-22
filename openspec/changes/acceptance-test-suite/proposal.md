## Why

The engine can already be driven through trade scenarios via `/simulate/tick`, but there is no way to run those scenarios end-to-end with order execution — the real cTrader broker is always required. We need a repeatable acceptance test suite that exercises the full stack (price feed → engine → order execution → UI) against a mock broker, produces before/after UI screenshots for each scenario, and can be run by any developer before a release.

## What Changes

- **New**: `IBrokerSession` interface extracted from `CTraderSession` so the broker transport can be swapped without changing `CTraderOrderExecutor`
- **New**: `MockBrokerSession` implements `IBrokerSession` — auto-confirms market orders with a fake `EXECUTION_EVENT` (POSITION_OPENED), auto-confirms close requests
- **New**: `MOCK_BROKER=true` env var causes `index.ts` to inject `MockBrokerSession` instead of a real `CTraderSession` into the executor (keeps production path untouched)
- **New**: Named scenario library (`acceptance-tests/scenarios/`) — each scenario is a TypeScript file declaring a setup YAML, a price tick sequence, and expected final engine state
- **New**: Acceptance test runner (`acceptance-tests/runner.ts`) — starts the engine subprocess with `MOCK_BROKER=true`, drives each scenario via HTTP, captures before/after Playwright screenshots, asserts final state, writes results to `acceptance-results/<timestamp>/`
- **New**: `npm run acceptance` script in `package.json`
- Playwright added as a dev dependency

## Capabilities

### New Capabilities

- `mock-broker-session`: Injectable `IBrokerSession` interface + `MockBrokerSession` implementation that auto-confirms orders — allows the full execution pipeline to run without a real broker
- `scenario-library`: Named scenario definitions covering the core engine state machine paths (long full, short full, DVS blocked/unblock, stopped out, time exit, daily lock)
- `acceptance-runner`: Orchestrator that starts the engine, runs scenarios, captures screenshots, asserts engine state, writes timestamped results

### Modified Capabilities

## Impact

- `src/trader/CTraderOrderExecutor.ts` — constructor accepts `IBrokerSession` instead of creating `CTraderSession` internally
- `src/price-feed/CTraderSession.ts` — `IBrokerSession` interface extracted (no behaviour change)
- `src/index.ts` — wires `MockBrokerSession` when `MOCK_BROKER=true`
- New files: `src/trader/IBrokerSession.ts`, `src/trader/MockBrokerSession.ts`
- New directory: `acceptance-tests/` (runner + scenarios)
- New directory: `acceptance-results/` (gitignored output)
- New dev dependency: `playwright`
