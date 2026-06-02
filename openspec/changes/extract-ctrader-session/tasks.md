## 1. Create CTraderSession

- [x] 1.1 Create `src/price-feed/CTraderSession.ts` — define `CTraderSessionConfig` interface (clientId, clientSecret, accessToken, accountId?, wsUrl?, noHeartbeat?, refreshToken?, tokenExpiresAt?, onTokenRefresh?)
- [x] 1.2 Move WebSocket open + APP_AUTH_REQ logic from `CTraderPriceFeed.connect()` into `CTraderSession.connect()`
- [x] 1.3 Move GET_ACCOUNTS_REQ / account selection logic into `CTraderSession`
- [x] 1.4 Move ACCOUNT_AUTH_REQ logic into `CTraderSession`
- [x] 1.5 Implement `onMessage(payloadType, handler)` registry and message dispatch in `CTraderSession`
- [x] 1.6 Move heartbeat (start/stop) into `CTraderSession`
- [x] 1.7 Move token refresh (`refreshAccessToken`) into `CTraderSession`
- [x] 1.8 Expose `send()`, `disconnect()`, `accountId` (getter) on `CTraderSession`

## 2. Refactor CTraderPriceFeed

- [x] 2.1 Replace internal WS/auth fields in `CTraderPriceFeed` with a `CTraderSession` instance
- [x] 2.2 Register handlers on the session for: `SYMBOL_LIST_RES`, `ACCOUNT_AUTH_RES` (to trigger symbol step), `SUBSCRIBE_SPOTS_RES`, `SPOT_EVENT`, `GET_TRENDBAR_RES`, `ERROR_RES`
- [x] 2.3 Delegate `connect()` and `disconnect()` to the session; keep symbol subscription logic in `CTraderPriceFeed`
- [x] 2.4 Ensure `getTodayBars()` still uses `session.send()` and the session's accountId getter
- [x] 2.5 Verify `CTraderPriceFeedConfig` interface is unchanged (no new required fields)

## 3. Tests and Docs

- [x] 3.1 Run `npm test` — all 144 tests must pass without modification
- [x] 3.2 Add a unit test for `CTraderSession` auth handshake using a mock WebSocket (app auth → accounts → account auth → settle)
- [x] 3.3 Update `developer-mental-notes.md` — note C2 decision (each consumer owns its own session) and the handler registry pattern
