## ADDED Requirements

### Requirement: Status band shows live account balance
The dashboard status band SHALL display an `Account` chip showing the live demo account balance. It SHALL show `—` when no trader is configured or before the first value arrives. The value SHALL be formatted to 2 decimal places with the currency symbol/code (e.g. `€ 100,000.00` or `EUR 100,000.00`).

#### Scenario: Balance displayed after connect
- **WHEN** the UI receives a `bootstrap` or `account_update` message with a non-null account
- **THEN** the account chip shows the formatted balance

#### Scenario: Balance shows dash when not configured
- **WHEN** the UI receives a `bootstrap` with `account: null`
- **THEN** the account chip shows `—`

### Requirement: Status band shows unrealized PnL when non-zero
Alongside the balance, the dashboard SHALL display the unrealized PnL from any open position. It SHALL be hidden (or show `—`) when zero or null. When non-zero, it SHALL be coloured green for positive and red for negative, with a `+` prefix for positive values.

#### Scenario: Positive unrealized PnL
- **WHEN** `unrealizedPnl > 0`
- **THEN** the value is shown in green with a `+` prefix (e.g. `+€ 125.50`)

#### Scenario: Negative unrealized PnL
- **WHEN** `unrealizedPnl < 0`
- **THEN** the value is shown in red (e.g. `-€ 80.00`)

#### Scenario: Zero unrealized PnL
- **WHEN** `unrealizedPnl === 0`
- **THEN** the PnL element is hidden or shows `—`

### Requirement: Balance updates live without page refresh
The UI SHALL apply `ACCOUNT_UPDATE` events to the balance and PnL display without requiring a page reload, using the same WebSocket event pipeline as other engine events.

#### Scenario: Live update on account_update event
- **WHEN** an `account_update` event arrives on the WebSocket
- **THEN** the balance chip and PnL display update immediately in place
