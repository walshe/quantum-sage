## ADDED Requirements

### Requirement: Executor uses live broker equity for position sizing
The system SHALL use the live account equity reported by the broker (via the C2 balance poll) as the `capital` input to `computeVolume` when placing orders. The static `capital.starting_capital_eur` config field SHALL be removed.

#### Scenario: Order placed with live balance available
- **WHEN** `CTraderOrderExecutor` places an order and a live balance has been received from the C2 session
- **THEN** `computeVolume` is called with the most recently received equity value

#### Scenario: Order placed before first balance poll returns
- **WHEN** `CTraderOrderExecutor` places an order and no live balance has been received yet
- **THEN** `computeVolume` is called with the value from the `CTRADER_ACCOUNT_BALANCE` env var
- **THEN** the system logs a warning indicating the env-var seed is in use

#### Scenario: No balance available at all
- **WHEN** `CTraderOrderExecutor` would place an order and neither a live balance nor `CTRADER_ACCOUNT_BALANCE` is available
- **THEN** `computeVolume` receives `0` as capital and returns `0` lots
- **THEN** no order is sent to the broker

### Requirement: Live balance is pushed to executor on each account update
The system SHALL call `executor.setLiveBalance(equity)` whenever `CTraderTrader` fires an `onAccountUpdate` callback, so the executor always holds a fresh equity figure without polling.

#### Scenario: Balance poll fires during active session
- **WHEN** the C2 balance poll receives a `TRADER_RES` response
- **THEN** the executor's internal equity value is updated before the next order is placed

### Requirement: `starting_capital_eur` removed from config
The `capital.starting_capital_eur` field SHALL be removed from `QSConfig` and `config.yaml`. The config loader SHALL NOT require or validate this field.

#### Scenario: Config file without `starting_capital_eur`
- **WHEN** the system starts with a `config.yaml` that does not contain `starting_capital_eur`
- **THEN** the system starts successfully with no validation error

#### Scenario: Config file still containing `starting_capital_eur`
- **WHEN** the system starts with a `config.yaml` that still contains `starting_capital_eur`
- **THEN** the system ignores the field (or warns and ignores) — it MUST NOT fail to start
