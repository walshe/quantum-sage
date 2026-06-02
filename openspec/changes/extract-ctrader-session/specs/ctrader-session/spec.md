## ADDED Requirements

### Requirement: Session drives the cTrader auth handshake
`CTraderSession` SHALL perform the full three-step handshake on connect: app authentication (`APP_AUTH_REQ`), account list retrieval (`GET_ACCOUNTS_REQ`), and account authentication (`ACCOUNT_AUTH_REQ`). It SHALL resolve its `connect()` promise only after the handshake completes, and reject if any step fails.

#### Scenario: Successful handshake
- **WHEN** `connect()` is called with valid app credentials and access token
- **THEN** the session sends APP_AUTH_REQ, then GET_ACCOUNTS_REQ, then ACCOUNT_AUTH_REQ in sequence, and `connect()` resolves without error

#### Scenario: Account not found
- **WHEN** `connect()` is called and GET_ACCOUNTS_RES contains no matching account
- **THEN** `connect()` rejects with a descriptive error

#### Scenario: API error during handshake
- **WHEN** an ERROR_RES is received before the handshake completes
- **THEN** `connect()` rejects with the error code and description

### Requirement: Session selects account by config or default
`CTraderSession` SHALL select the trading account using `accountId` from config if provided. If not provided, it SHALL pick the first live account (`isLive: true`) from the account list, falling back to `accounts[0]` if no live account exists.

#### Scenario: Explicit account ID
- **WHEN** `accountId` is set in config
- **THEN** the session authenticates exactly that account

#### Scenario: No account ID — live account present
- **WHEN** `accountId` is not set and at least one live account exists
- **THEN** the session authenticates the first live account

#### Scenario: No account ID — demo-only environment
- **WHEN** `accountId` is not set and no live account exists (e.g. demo server)
- **THEN** the session authenticates `accounts[0]`

### Requirement: Session exposes typed message handler registry
`CTraderSession` SHALL provide `onMessage(payloadType: number, handler: (msg) => void)` so consumers can register for specific payload types. When an inbound message arrives, the session SHALL dispatch it to the registered handler for that payload type, if one exists.

#### Scenario: Handler receives its payload type
- **WHEN** a message with a registered payloadType arrives on the socket
- **THEN** the corresponding handler is called with the full message

#### Scenario: Unregistered payload type
- **WHEN** a message arrives for a payloadType with no registered handler
- **THEN** the session logs a debug entry and discards the message silently

### Requirement: Session sends heartbeats and handles token refresh
`CTraderSession` SHALL send a heartbeat (`payloadType 51`) on a fixed interval after connect, unless `noHeartbeat` is set in config. It SHALL proactively refresh the access token before connecting if it is within 5 minutes of expiry and a refresh token is configured.

#### Scenario: Heartbeat disabled for demo
- **WHEN** `noHeartbeat: true` is set in config
- **THEN** no heartbeat messages are sent

#### Scenario: Token refreshed before expiry
- **WHEN** the access token is within 300 seconds of expiry at connect time and a refresh token is configured
- **THEN** the session refreshes the token before opening the WebSocket

### Requirement: CTraderPriceFeed external interface is unchanged
After the refactor, `CTraderPriceFeed` SHALL retain its existing constructor signature, `PriceFeed` interface (`subscribe`, `getLatestPrice`, `connect`, `disconnect`), and `getTodayBars()` method. No caller SHALL require modification.

#### Scenario: Existing callers unaffected
- **WHEN** `CTraderPriceFeed` is constructed with the same `CTraderPriceFeedConfig` as before
- **THEN** it connects, subscribes, and emits prices identically to the pre-refactor behaviour
