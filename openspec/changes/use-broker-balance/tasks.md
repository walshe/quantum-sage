## 1. Config Cleanup

- [x] 1.1 Remove `starting_capital_eur` from `QSConfig` interface in `src/config/types.ts`
- [x] 1.2 Remove validation of `starting_capital_eur` in `src/config/loader.ts`
- [x] 1.3 Remove `starting_capital_eur` from `config.yaml`

## 2. Executor — Live Balance Wiring

- [x] 2.1 Add `private liveBalanceEur: number | null = null` field to `CTraderOrderExecutor`
- [x] 2.2 Add `setLiveBalance(eur: number): void` method to `CTraderOrderExecutor`
- [x] 2.3 Replace `this.qsConfig.capital.starting_capital_eur` with `this.liveBalanceEur ?? envSeedBalance ?? 0` in both `computeVolume` call sites
- [x] 2.4 Log a `warn` when the env-var seed is used (live balance not yet available)
- [x] 2.5 Guard against `0` capital: if effective capital is `0`, skip order and log a `warn`

## 3. Wiring in index.ts

- [x] 3.1 Seed executor with `Number(env.CTRADER_ACCOUNT_BALANCE) || 0` on construction (pass as constructor param or call `setLiveBalance` immediately after instantiation)
- [x] 3.2 In the `onAccountUpdate` callback, call `executor.setLiveBalance(info.balance)` so every balance poll update flows into the executor

## 4. Tests

- [x] 4.1 Update `CTraderOrderExecutor` tests: remove `starting_capital_eur` from test config fixtures
- [x] 4.2 Add test: executor uses `setLiveBalance` value when computing volume
- [x] 4.3 Add test: executor falls back to env-var seed when `setLiveBalance` not yet called
- [x] 4.4 Add test: executor returns 0 lots and does not call session when capital is 0
- [x] 4.5 Run full test suite — all tests green

## 5. Docs

- [x] 5.1 Update `PRD.md` — capital/sizing section to remove `starting_capital_eur` reference, note live balance is used
- [x] 5.2 Update `ARCHITECTURE.md` if it references static capital config
- [x] 5.3 Update `developer-mental-notes.md` — note the breaking config change and migration step
- [x] 5.4 Run `npm test` one final time to confirm green
