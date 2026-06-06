## 1. Simulation Endpoint

- [x] 1.1 Add POST `/simulate/tick` route to WebServer that accepts `{ price: number }` and calls a registered price injection callback
- [x] 1.2 Gate the endpoint: return 404 if `NODE_ENV === 'production'`, return 400 if `auto_execute` is enabled
- [x] 1.3 Expose a `setSimulationPriceCallback(fn)` method on WebServer so index.ts can wire in the engine's price handler
- [x] 1.4 Add GET `/api/state` endpoint returning `{ state, dailyLocked }` so the simulation script can poll for readiness

## 2. Simulation Script

- [x] 2.1 Create `scripts/simulate-trade.ts` with the step sequence: write YAML → wait for watching → inject prices through all 3 entries → breakeven → VWAP close
- [x] 2.2 Write a realistic setup YAML with today's date, neutral bias, and synthetic levels (e.g. Entry 1=7500, Entry 2 mid=7487, Entry 3=7475, VWAP=7540, stop=40pts)
- [x] 2.3 Poll `GET /api/state` after writing the YAML and wait (up to 10s) for `state === "watching"` before injecting prices
- [x] 2.4 Inject Entry 1 price (triggers fill 1 at 32.5%), pause `SIMULATE_STEP_MS`
- [x] 2.5 Inject Entry 2 mid price (triggers fill 2 at 35%), pause `SIMULATE_STEP_MS`
- [x] 2.6 Inject Entry 3 price (triggers fill 3 at 32.5%), pause `SIMULATE_STEP_MS`
- [x] 2.7 Inject price at avg_entry + 25pts (triggers breakeven), pause `SIMULATE_STEP_MS`
- [x] 2.8 Inject VWAP price (triggers position close), pause `SIMULATE_STEP_MS`
- [x] 2.9 Print step-by-step progress to the terminal so the developer knows what's happening

## 3. npm Script

- [x] 3.1 Add `"simulate": "tsx scripts/simulate-trade.ts"` to package.json scripts

## 4. Tests

- [x] 4.1 Add a unit test verifying the simulation endpoint returns 404 when called with `NODE_ENV=production`
- [x] 4.2 Add a unit test verifying the endpoint returns 400 when `auto_execute` is true
