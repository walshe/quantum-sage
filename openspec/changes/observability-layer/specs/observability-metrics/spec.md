## ADDED Requirements

### Requirement: MetricsBackend interface
The system SHALL define a `MetricsBackend` interface in `src/observability/types.ts` that abstracts all metric recording operations. The interface SHALL expose: `recordTick(price)`, `recordSignalLoaded(valid)`, `recordEngineState(state)`, `recordEntry(entryNum, direction)`, `recordClose(reason, pnlPoints)`, `recordConnectionState(connected)`, and `setTickRate(ticksPerMinute)`. A `NoopBackend` implementation SHALL be provided that satisfies the interface with empty method bodies and is used when observability is disabled.

#### Scenario: Observability disabled at startup
- **WHEN** the engine starts without an `--observability` flag
- **THEN** a `NoopBackend` instance is used and no metrics are collected or emitted

#### Scenario: Backend is backend-agnostic from engine perspective
- **WHEN** `TridentEngine` or `CTraderPriceFeed` record a metric
- **THEN** they call only `MetricsBackend` interface methods, importing no concrete backend class

### Requirement: Tick metric instrumentation
The system SHALL record a metric for every price tick received from the feed. The instrumentation point SHALL be in `index.ts` at the boundary where the feed callback forwards to the engine, not inside `TridentEngine` or `CTraderPriceFeed`.

#### Scenario: Tick received from live feed
- **WHEN** `CTraderPriceFeed` delivers a price update
- **THEN** `backend.recordTick(price)` is called before `engine.onPriceUpdate(price)` is called

#### Scenario: Tick received in mock mode
- **WHEN** `--mock` flag is used and `MockPriceFeed` delivers ticks
- **THEN** no metrics are recorded (mock mode does not initialise a backend)

### Requirement: Tick rate tracking
The system SHALL compute a rolling tick rate (ticks per minute) and update the backend every 60 seconds via `setTickRate(ticksPerMinute)`. The rate SHALL be computed as the count of ticks received in the previous 60-second window.

#### Scenario: Tick rate reported after first minute
- **WHEN** at least 60 seconds have elapsed since the feed connected
- **THEN** `backend.setTickRate(n)` is called with the count of ticks in the prior 60s window

#### Scenario: Tick rate reported as zero during disconnection
- **WHEN** no ticks are received in a 60-second window
- **THEN** `backend.setTickRate(0)` is called

### Requirement: Signal load metric instrumentation
The system SHALL record a metric whenever a signal file is processed, distinguishing valid and invalid outcomes.

#### Scenario: Valid signal loaded
- **WHEN** `engine.loadSignal()` processes a signal that passes validation
- **THEN** `backend.recordSignalLoaded(true)` is called

#### Scenario: Invalid signal rejected
- **WHEN** `engine.loadSignal()` processes a signal that fails validation
- **THEN** `backend.recordSignalLoaded(false)` is called

### Requirement: Engine state metric instrumentation
The system SHALL record a metric whenever the engine transitions between states (`idle`, `blocked`, `watching`, `in_trade`, `closed`). The instrumentation SHALL use the existing `NotificationEvent` types observed by a `MetricsNotifier` decorator rather than coupling directly to `TridentEngine` internals.

#### Scenario: Engine transitions to watching state
- **WHEN** a `SETUP_READY` notification event is emitted
- **THEN** `backend.recordEngineState('watching')` is called

#### Scenario: Engine transitions to in_trade state
- **WHEN** an `ENTRY_TRIGGERED` notification event is emitted for entry 1
- **THEN** `backend.recordEngineState('in_trade')` is called

#### Scenario: Engine transitions to closed state
- **WHEN** a `POSITION_CLOSED` notification event is emitted
- **THEN** `backend.recordEngineState('closed')` is called

### Requirement: Entry metric instrumentation
The system SHALL record a metric for each entry fill, labelled with entry number (1, 2, or 3) and direction (`long` or `short`).

#### Scenario: Entry fill recorded
- **WHEN** an `ENTRY_TRIGGERED` notification event is emitted
- **THEN** `backend.recordEntry(entryNum, direction)` is called with the entry number and direction from the event

### Requirement: Position close metric instrumentation
The system SHALL record a metric for each position close, labelled with the close reason (`stop`, `vwap`, `time_exit`, `hard_exit`, `invalidation`, `expiry`) and the P&L in points.

#### Scenario: Position closed with P&L
- **WHEN** a `POSITION_CLOSED` notification event is emitted
- **THEN** `backend.recordClose(reason, pnlPoints)` is called with the reason and point P&L from the event

### Requirement: Connection state metric instrumentation
The system SHALL record a metric for feed connection and disconnection events.

#### Scenario: Feed connects successfully
- **WHEN** `CTraderPriceFeed.connect()` resolves
- **THEN** `backend.recordConnectionState(true)` is called

#### Scenario: Feed disconnects or fails
- **WHEN** `CTraderPriceFeed` disconnects or `connectWithRetry` catches an error
- **THEN** `backend.recordConnectionState(false)` is called
