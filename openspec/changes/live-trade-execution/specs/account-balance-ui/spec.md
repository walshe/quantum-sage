## MODIFIED Requirements

### Requirement: Status band shows unrealized PnL when non-zero
Alongside the balance, the dashboard SHALL display the unrealized PnL from any open position. It SHALL be hidden (or show `—`) when zero or null. When non-zero, it SHALL be coloured green for positive and red for negative, with a `+` prefix for positive values. The value SHALL include the currency symbol (e.g. `+€ 125.50`).

#### Scenario: Positive unrealized PnL
- **WHEN** `unrealizedPnl > 0`
- **THEN** the value is shown in green with a `+` prefix (e.g. `+€ 125.50`)

#### Scenario: Negative unrealized PnL
- **WHEN** `unrealizedPnl < 0`
- **THEN** the value is shown in red (e.g. `-€ 80.00`)

#### Scenario: Zero unrealized PnL
- **WHEN** `unrealizedPnl === 0`
- **THEN** the PnL element is hidden or shows `—`

## ADDED Requirements

### Requirement: Open Position panel shows live broker unrealizedPnL
The Open Position panel on the right side of the dashboard SHALL include a `Broker P&L` row showing the `unrealizedPnl` value from the most recent `account_update` or `bootstrap` message. It SHALL be shown only when a position is open (`state: "in_trade"`). The value SHALL be coloured green for positive, red for negative, with `+` prefix for positive values and 2 decimal places with currency symbol.

#### Scenario: Broker P&L appears when in trade
- **WHEN** the engine state is `in_trade` and an `account_update` arrives with non-null `unrealizedPnl`
- **THEN** the Open Position panel shows a `Broker P&L` row with the formatted value

#### Scenario: Broker P&L hidden when not in trade
- **WHEN** the engine state is not `in_trade`
- **THEN** the `Broker P&L` row is not rendered in the position panel

#### Scenario: Broker P&L updates live
- **WHEN** a new `account_update` event arrives while in trade
- **THEN** the `Broker P&L` row updates immediately without page reload
