## ADDED Requirements

### Requirement: Simulation endpoint
The web server SHALL expose a dev-only POST `/simulate/tick` endpoint that accepts a `{ price: number }` body and injects that price into the engine as if it came from the live feed. The endpoint SHALL return 404 in production (`NODE_ENV=production`). The endpoint SHALL return 400 if `auto_execute` is enabled in config.

#### Scenario: Price tick injected successfully
- **WHEN** a POST to `/simulate/tick` with `{ "price": 7500 }` is received in dev mode
- **THEN** the engine processes the price and fires any triggered events (ENTRY_TRIGGERED, etc.)

#### Scenario: Endpoint blocked in production
- **WHEN** a POST to `/simulate/tick` is received with `NODE_ENV=production`
- **THEN** the server returns 404

#### Scenario: Endpoint blocked when auto_execute is on
- **WHEN** a POST to `/simulate/tick` is received and `config.execution.auto_execute` is `true`
- **THEN** the server returns 400 with message "auto_execute is enabled — disable it before simulating"

### Requirement: Simulation npm script
The system SHALL provide an `npm run simulate` script that runs `scripts/simulate-trade.ts`. The script SHALL walk through the full trade scenario automatically with a configurable step delay (default 2000ms, overridable via `SIMULATE_STEP_MS` env var).

#### Scenario: Full scenario runs end-to-end
- **WHEN** `npm run simulate` is run with the engine running on localhost:3000
- **THEN** the script injects a setup file, then drives prices through Entry 1 → Entry 2 → Entry 3 → breakeven → VWAP close, pausing `SIMULATE_STEP_MS` between each step

#### Scenario: Custom step delay
- **WHEN** `SIMULATE_STEP_MS=500 npm run simulate` is run
- **THEN** each step waits 500ms instead of the default 2000ms

### Requirement: Simulation scenario sequence
The simulation script SHALL drive the engine through this exact sequence:

1. Write a YAML setup file to `setups/` with today's date, neutral bias, realistic levels, and a VWAP target
2. Wait for the engine to load the setup (poll `/api/state` until `state === "watching"`)
3. Inject prices just above Entry 1 (watching state — no trigger)
4. Inject price at Entry 1 → triggers `ENTRY_TRIGGERED` fill 1 (32.5%)
5. Inject price at Entry 2 (mid) → triggers `ENTRY_TRIGGERED` fill 2 (35%)
6. Inject price at Entry 3 (BUY OUTER) → triggers `ENTRY_TRIGGERED` fill 3 (32.5%)
7. Inject price at avg_entry + 25pts → triggers `BREAKEVEN_TRIGGERED`
8. Inject price at VWAP → triggers `POSITION_CLOSED`

#### Scenario: Engine is in watching state after setup injection
- **WHEN** the simulation script writes the setup YAML and waits
- **THEN** the engine transitions to `watching` state within 5 seconds

#### Scenario: All three entries fire in sequence
- **WHEN** prices are injected at Entry 1, Entry 2, and Entry 3 levels
- **THEN** three `ENTRY_TRIGGERED` events fire in order with allocations 32.5%, 35%, 32.5%

#### Scenario: Breakeven fires after position is fully open
- **WHEN** price is injected 25pts above avg entry after all 3 fills
- **THEN** `BREAKEVEN_TRIGGERED` fires and the stop is moved to avg entry

#### Scenario: Position closes at VWAP
- **WHEN** price is injected at the VWAP level
- **THEN** `POSITION_CLOSED` fires and the engine transitions to `closed` state
