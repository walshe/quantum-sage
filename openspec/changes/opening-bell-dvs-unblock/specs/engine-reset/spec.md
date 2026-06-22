## ADDED Requirements

### Requirement: Engine reset endpoint
The server SHALL expose `POST /engine/reset` that calls `engine.reset()`, clears the snapshot, and returns the new engine state. The endpoint SHALL return HTTP 409 if the engine is currently in `in_trade` state, with a message explaining that a trade is open.

#### Scenario: Reset from blocked state
- **WHEN** engine state is `blocked` and `POST /engine/reset` is called
- **THEN** engine state becomes `idle`, snapshot is cleared, and response is `{ state: 'idle' }`

#### Scenario: Reset from watching state
- **WHEN** engine state is `watching` and `POST /engine/reset` is called
- **THEN** engine state becomes `idle`, snapshot is cleared, and response is `{ state: 'idle' }`

#### Scenario: Reset rejected while in trade
- **WHEN** engine state is `in_trade` and `POST /engine/reset` is called
- **THEN** response is HTTP 409 with `{ error: 'Cannot reset while a trade is open' }`

### Requirement: Reset button in UI
The action strip SHALL include a "Reset engine" button that calls `POST /engine/reset`. The button SHALL show a confirmation dialog before proceeding. On success the button SHALL display a brief confirmation message. If the reset is rejected (409), the button SHALL display the error reason.

#### Scenario: Successful reset from blocked
- **WHEN** analyst clicks "Reset engine" and confirms
- **THEN** `POST /engine/reset` is called, engine returns to idle, status pane updates

#### Scenario: Reset blocked while in trade
- **WHEN** analyst clicks "Reset engine" and confirms while a trade is open
- **THEN** an error message is shown: "Cannot reset while a trade is open"

#### Scenario: Reset button has confirmation step
- **WHEN** analyst clicks "Reset engine"
- **THEN** a confirmation dialog appears before the reset is sent to the server
