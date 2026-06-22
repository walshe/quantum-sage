## ADDED Requirements

### Requirement: Scenario type definition
The system SHALL define a `Scenario` TypeScript interface in `acceptance-tests/types.ts` with the following fields:
- `name: string` — kebab-case identifier, used as directory name in results
- `description: string` — human-readable label
- `setup: SetupFields` — typed setup YAML values (levels, DVS, VWAP, bias, etc.)
- `steps: ScenarioStep[]` — ordered price injections; each step has `label`, `price`, optional `accountUpdate`, optional `screenshot: true`, optional `expectState: EngineState`
- `expectedFinalState: EngineState`

#### Scenario: Scenario file is a typed TypeScript module
- **WHEN** a new scenario file is added to `acceptance-tests/scenarios/`
- **THEN** TypeScript compilation SHALL catch missing required fields or invalid state names

### Requirement: Core scenario coverage
The scenario library SHALL include at minimum the following named scenarios, each in its own file under `acceptance-tests/scenarios/`:

1. `long-full` — long bias, all 3 entries trigger, breakeven triggers, VWAP close. Final state: `closed`.
2. `short-full` — short bias, all 3 entries trigger (sell side), breakeven triggers, VWAP close. Final state: `closed`.
3. `long-stopped-out` — long bias, entry 1 triggers, price reverses past stop. Final state: `closed`.
4. `long-time-exit` — long bias, entry 1 triggers, time_exit fires (runner sets `time_exit_minutes: 1` in config override). Final state: `closed`.
5. `dvs-blocked` — DVS above gate in setup, engine blocks immediately. Final state: `blocked`.
6. `dvs-unblock` — DVS above gate → blocked, then re-submit with DVS below gate → watching. Final state: `watching`.
7. `neutral-bias-long` — neutral bias with both level pairs, price drops to long side. Final state: `closed` (after full long trade).

#### Scenario: long-full scenario reaches closed state
- **WHEN** the `long-full` scenario runs to completion
- **THEN** GET `/api/state` returns `{ state: 'closed' }`

#### Scenario: dvs-blocked scenario reaches blocked state
- **WHEN** the `dvs-blocked` scenario submits a setup with DVS above the configured gate
- **THEN** GET `/api/state` returns `{ state: 'blocked' }`

#### Scenario: dvs-unblock scenario returns to watching after re-submit
- **WHEN** the `dvs-unblock` scenario re-submits with DVS below gate after being blocked
- **THEN** GET `/api/state` returns `{ state: 'watching' }`
