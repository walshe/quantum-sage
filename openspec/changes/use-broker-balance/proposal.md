## Why

`config.yaml` currently requires a hardcoded `capital.starting_capital_eur` value which is used as the basis for position sizing. This is fragile: the configured value drifts from the real account equity over time as the account gains or loses, meaning lot sizes are calculated against a stale number rather than what the broker actually holds. Since the system already polls live balance from the broker via `CTraderTrader` (C2 session), the real equity is available — we should use it.

## What Changes

- **Remove** `capital.starting_capital_eur` from `config.yaml` and `QSConfig` (the only use is as the `capital` input to `computeVolume`)
- **Feed live broker equity** into `CTraderOrderExecutor` so `computeVolume` always uses the current account equity from the C2 balance poll
- **Fallback** to `CTRADER_ACCOUNT_BALANCE` env var for the case where the balance poll has not yet returned (startup window) or the C2 session is not connected (advisory/mock mode)
- `capital.daily_risk_pct` remains in config — that is a strategy parameter, not a live account value
- **BREAKING**: `capital.starting_capital_eur` removed from `config.yaml`; existing config files must drop the field

## Capabilities

### New Capabilities

- `broker-balance-for-sizing`: Live broker equity (from C2 balance poll) is the capital input to `computeVolume`. `CTraderOrderExecutor` holds a reference to the latest broker equity, updated on every `ACCOUNT_UPDATE` event. Falls back to `CTRADER_ACCOUNT_BALANCE` env var if no live balance available.

### Modified Capabilities

<!-- No existing spec files to delta — no openspec/specs/ directory yet -->

## Impact

- `src/config/types.ts` — remove `starting_capital_eur` from `capital` interface
- `src/config/loader.ts` — remove validation for `starting_capital_eur`
- `src/trader/CTraderOrderExecutor.ts` — accept live equity as input; remove `qsConfig.capital.starting_capital_eur` usage
- `src/index.ts` — wire live `AccountInfo.balance` (from `CTraderTrader` updates) into `CTraderOrderExecutor`
- `config.yaml` — remove `starting_capital_eur` field
- Tests: `volumeCalculator.test.ts` unaffected; `CTraderOrderExecutor` integration tests need updating
- `ARCHITECTURE.md` / `PRD.md` — update capital/sizing documentation
