## ADDED Requirements

### Requirement: Runner starts and stops engine subprocess
The acceptance runner SHALL start the Trident engine as a child process (`tsx src/index.ts`) with `MOCK_BROKER=true`, `NODE_ENV=test`, `auto_execute: true` in config, and a test-specific `setups/` directory. It SHALL poll `GET /api/state` until the engine responds (max 15s) before running any scenario. It SHALL terminate the subprocess after all scenarios complete (or on error).

#### Scenario: Runner waits for engine readiness
- **WHEN** the runner starts the engine subprocess
- **THEN** it polls `/api/state` every 300ms and proceeds only when a 200 response is received
- **AND** if no response within 15s it exits with a non-zero code and a clear error message

#### Scenario: Runner terminates engine on completion
- **WHEN** all scenarios have run (pass or fail)
- **THEN** the engine subprocess is killed and the runner process exits

### Requirement: Runner executes each scenario in isolation
For each scenario the runner SHALL:
1. Reset the engine to idle via `POST /engine/reset`
2. Write the scenario setup YAML to the watched `setups/` directory
3. Wait for engine state to become `watching` (or `blocked` for DVS scenarios)
4. Take a **before** Playwright screenshot
5. Inject each price step via `POST /simulate/tick`; for steps with `accountUpdate`, also `POST /simulate/account`
6. For steps with `screenshot: true`, take a mid-scenario screenshot
7. After the final step, wait for `expectedFinalState` via `GET /api/state` (max 10s)
8. Take an **after** Playwright screenshot
9. Assert actual final state equals `expectedFinalState`; record pass/fail

#### Scenario: Scenario isolation via engine reset
- **WHEN** a scenario starts
- **THEN** `POST /engine/reset` is called first so prior scenario state does not bleed through

#### Scenario: Screenshot captured before price injection
- **WHEN** the engine has loaded the setup and reached `watching` state
- **THEN** a Playwright screenshot is saved as `<results-dir>/<scenario>/before.png` before any prices are injected

#### Scenario: Screenshot captured after final state reached
- **WHEN** the engine has reached `expectedFinalState`
- **THEN** a Playwright screenshot is saved as `<results-dir>/<scenario>/after.png`

### Requirement: Runner writes timestamped results
The runner SHALL write all output to `acceptance-results/<ISO-timestamp>/`. For each scenario it SHALL write:
- `before.png`
- `after.png`
- `steps/<n>-<label>.png` for any mid-scenario screenshot steps
- `result.json` with `{ scenario, passed, expectedState, actualState, durationMs, error? }`

After all scenarios it SHALL write `summary.json` with overall pass/fail counts and total duration, and print a summary table to stdout.

#### Scenario: Results directory created per run
- **WHEN** the runner starts
- **THEN** a directory `acceptance-results/<timestamp>/` is created before any scenarios run

#### Scenario: summary.json written on completion
- **WHEN** all scenarios have finished
- **THEN** `summary.json` is written with `{ totalScenarios, passed, failed, durationMs }`
- **AND** the runner exits with code 0 if all passed, code 1 if any failed

### Requirement: acceptance-results gitignored
`acceptance-results/` SHALL be listed in `.gitignore` so generated screenshots and result JSON files are never committed.

#### Scenario: Results not committed
- **WHEN** a developer runs `git status` after an acceptance run
- **THEN** no files under `acceptance-results/` appear as untracked

### Requirement: npm run acceptance script
`package.json` SHALL include a script `"acceptance": "tsx acceptance-tests/runner.ts"` runnable from `trident/impl/nodejs/`.

#### Scenario: Runner invocable via npm
- **WHEN** developer runs `npm run acceptance` from `trident/impl/nodejs/`
- **THEN** the acceptance runner starts and executes all scenarios
