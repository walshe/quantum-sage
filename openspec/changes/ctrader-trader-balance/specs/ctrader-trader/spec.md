## ADDED Requirements

### Requirement: CTraderTrader connects and fetches account balance
`CTraderTrader` SHALL create its own `CTraderSession`, connect to the cTrader demo endpoint, and send `ProtoOATraderReq` (payloadType 2120) after `ACCOUNT_AUTH_RES`. It SHALL parse the response and expose `balance`, `equity`, and `unrealizedPnl` (equity − balance), all as numbers in account currency.

#### Scenario: Successful balance fetch on connect
- **WHEN** `CTraderTrader.connect()` is called with valid credentials
- **THEN** it authenticates via `CTraderSession`, sends TRADER_REQ, and resolves with balance and equity populated

#### Scenario: TRADER_RES integer decoding
- **WHEN** the server returns balance and equity as integers with `moneyDigits: 2`
- **THEN** both values are divided by 100 before being exposed

#### Scenario: Connection failure
- **WHEN** `CTraderSession.connect()` rejects
- **THEN** `CTraderTrader.connect()` rejects with the same error

### Requirement: CTraderTrader refreshes balance on a 30-second poll
After the initial fetch, `CTraderTrader` SHALL send `ProtoOATraderReq` every 30 seconds to refresh balance and equity. It SHALL skip the poll if the session is not connected.

#### Scenario: Poll fires and updates values
- **WHEN** 30 seconds elapse after the previous fetch
- **THEN** a new TRADER_REQ is sent and the response updates balance, equity, and unrealizedPnl

#### Scenario: Poll skipped when disconnected
- **WHEN** the poll interval fires but the session is not open
- **THEN** no message is sent and no error is thrown

### Requirement: CTraderTrader emits ACCOUNT_UPDATE on value change
`CTraderTrader` SHALL call a registered `onAccountUpdate` callback whenever balance or equity changes, passing `{ balance, equity, unrealizedPnl, currency }`.

#### Scenario: Callback fires after initial fetch
- **WHEN** the first TRADER_RES arrives
- **THEN** `onAccountUpdate` is called with the decoded values

#### Scenario: Callback fires after poll detects a change
- **WHEN** a poll response contains different balance or equity than the previous values
- **THEN** `onAccountUpdate` is called with the new values

#### Scenario: Callback not fired when values are unchanged
- **WHEN** a poll response contains the same balance and equity as before
- **THEN** `onAccountUpdate` is NOT called
