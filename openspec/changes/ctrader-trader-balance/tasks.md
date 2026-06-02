## 1. CTraderTrader class

- [x] 1.1 Create `src/trader/CTraderTrader.ts` — define `CTraderTraderConfig` interface (same session fields as `CTraderSessionConfig` + `onAccountUpdate` callback)
- [x] 1.2 Implement `connect()`: create `CTraderSession`, register `ACCOUNT_AUTH_RES` handler to send `TRADER_REQ` (PT.TRADER_REQ / 2120), register `TRADER_RES` handler to decode balance + equity
- [x] 1.3 Decode TRADER_RES: divide raw integer fields by `10 ** moneyDigits`; extract currency; compute `unrealizedPnl = equity - balance`; log raw response on first call so we can verify field names against the live API
- [x] 1.4 Fire `onAccountUpdate({ balance, equity, unrealizedPnl, currency })` on initial fetch and on any poll that returns changed values
- [x] 1.5 Start a 30-second poll after the initial fetch; skip poll if session is not connected; stop poll on `disconnect()`
- [x] 1.6 Implement `disconnect()`: stop poll, disconnect session

## 2. Notifier and Bootstrap

- [x] 2.1 Add `AccountInfo` type to `src/notifier/Notifier.ts`: `{ balance: number; equity: number; unrealizedPnl: number; currency: string }`
- [x] 2.2 Add `ACCOUNT_UPDATE` event to the `Notifier` event union: `{ type: 'ACCOUNT_UPDATE' } & AccountInfo`
- [x] 2.3 Add optional `account: AccountInfo | null` field to `Bootstrap` in `WebSocketNotifier.ts`
- [x] 2.4 Add `account_update` to the WebSocket envelope union and handle it in `WebSocketNotifier.notify()` — broadcast `{ kind: 'account_update', data: AccountInfo }` to all connected clients

## 3. Wire into index.ts

- [x] 3.1 In `index.ts`, create `CTraderTrader` with the same credentials as the price feed when cTrader env vars are present; pass `onAccountUpdate` callback that calls `notifier.notify({ type: 'ACCOUNT_UPDATE', ... })`
- [x] 3.2 Store latest `AccountInfo` in a variable; include it in the `getBootstrap()` closure as `account` (null when trader not configured)
- [x] 3.3 Connect `CTraderTrader` with the same `connectWithRetry` pattern used by the price feed

## 4. UI

- [x] 4.1 Add `account` chip to the status band in `index.html` (after the price chip): label `Account`, value element `id="account-chip-value"`, tooltip explaining it shows live demo balance
- [x] 4.2 Add `unrealizedPnl` span inside or beside the account chip: `id="unrealized-pnl"`, hidden by default
- [x] 4.3 In `app.js`, update `handleBootstrap()` to call a new `updateAccountChip(account)` helper when `b.account` is present
- [x] 4.4 In `app.js`, handle `account_update` envelope: call `updateAccountChip(msg.data)`
- [x] 4.5 Implement `updateAccountChip({ balance, equity, unrealizedPnl, currency })`: format balance to 2dp with currency, show/hide and colour `unrealized-pnl` based on sign
- [x] 4.6 Add CSS for `.chip--account`, `.pnl--positive` (green), `.pnl--negative` (red) in `styles.css`

## 5. Tests and Docs

- [x] 5.1 Run `npm test` — all existing tests must pass
- [x] 5.2 Add unit tests for `CTraderTrader`: TRADER_RES decoding (integer → float), `onAccountUpdate` fires on change but not on identical values, poll skip when disconnected
- [x] 5.3 Update `developer-mental-notes.md` — document `CTraderTrader`, the TRADER_REQ/RES field names (once verified against live API), and the poll design
