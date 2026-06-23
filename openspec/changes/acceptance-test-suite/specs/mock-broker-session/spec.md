## ADDED Requirements

### Requirement: IBrokerSession interface
The system SHALL define an `IBrokerSession` interface in `src/trader/IBrokerSession.ts` that captures the surface of `CTraderSession` used by `CTraderOrderExecutor`: `connect()`, `disconnect()`, `send()`, `onMessage()`, and the `accountId` getter. `CTraderOrderExecutor` SHALL depend on this interface rather than the concrete `CTraderSession` class.

#### Scenario: Existing production wiring unchanged
- **WHEN** `index.ts` starts with `MOCK_BROKER` unset or `false`
- **THEN** `CTraderOrderExecutor` creates and uses a real `CTraderSession` exactly as before

#### Scenario: Mock injected via constructor
- **WHEN** a `MockBrokerSession` instance is passed as the optional `session` argument to `CTraderOrderExecutor`
- **THEN** the executor uses the mock session for all broker communication and never creates a `CTraderSession`

### Requirement: MockBrokerSession auto-confirms market orders
`MockBrokerSession` SHALL implement `IBrokerSession`. When `send()` is called with payload type `NEW_ORDER_REQ`, the mock SHALL asynchronously (via `setImmediate`) fire a fake `EXECUTION_EVENT` with `executionType: 'POSITION_OPENED'` and a synthetic `positionId` to all registered `EXECUTION_EVENT` handlers.

#### Scenario: Market order auto-fill
- **WHEN** `CTraderOrderExecutor.notify({ type: 'ENTRY_TRIGGERED', ... })` is called and the executor sends a `NEW_ORDER_REQ` to `MockBrokerSession`
- **THEN** `MockBrokerSession` fires a `POSITION_OPENED` execution event on `setImmediate`
- **AND** `CTraderOrderExecutor.hasBrokerPosition()` returns `true` after the event is processed

### Requirement: MockBrokerSession auto-confirms position closes
When `send()` is called with payload type `CLOSE_POSITION_REQ`, `MockBrokerSession` SHALL fire a fake `EXECUTION_EVENT` with `executionType: 'ORDER_FILLED'` on `setImmediate`.

#### Scenario: Position close confirmed
- **WHEN** `CTraderOrderExecutor.notify({ type: 'POSITION_CLOSED' })` is called
- **THEN** `MockBrokerSession` fires an `ORDER_FILLED` execution event
- **AND** `CTraderOrderExecutor` internal state resets (positionId back to null)

### Requirement: MOCK_BROKER env var controls broker selection in index.ts
`index.ts` SHALL read `process.env.MOCK_BROKER`. When set to `'true'`, it SHALL pass a `MockBrokerSession` as the `session` argument to `CTraderOrderExecutor`. This path SHALL still require `config.execution.auto_execute: true` — the mock broker is not a simulation bypass, it is a broker transport replacement.

#### Scenario: MOCK_BROKER=true selects mock session
- **WHEN** the engine starts with `MOCK_BROKER=true` and `auto_execute: true` in config
- **THEN** `CTraderOrderExecutor` uses `MockBrokerSession` and no TCP connection to cTrader is attempted

#### Scenario: MOCK_BROKER unset uses real session
- **WHEN** the engine starts without `MOCK_BROKER` set
- **THEN** `CTraderOrderExecutor` creates a real `CTraderSession` (existing behaviour)
