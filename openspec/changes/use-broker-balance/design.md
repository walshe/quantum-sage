## Context

The volume calculator (`computeVolume`) needs a capital figure as input. Today that figure comes from `config.yaml → capital.starting_capital_eur`. This is a static number set once at deployment and never updated — it drifts from reality as the account grows or shrinks.

The system already has live equity via `CTraderTrader` (C2 balance poll, every 30 s). This data is already being pushed to the UI and notifier chain as `AccountInfo`. The gap is that `CTraderOrderExecutor` (C3 session) does not receive it — it pulls capital from the static config instead.

## Goals / Non-Goals

**Goals:**
- `computeVolume` always uses the most recent broker equity when auto-execution is active
- `starting_capital_eur` is removed from config; no stale manual figure needed
- Clean startup: system can start before the first balance poll returns (use env-var seed)
- No breaking change to `computeVolume` itself — it still accepts a plain number

**Non-Goals:**
- Changing how `CTraderTrader` polls (C2 is fine as-is)
- Supporting multiple currencies (balance assumed EUR; out of scope)
- Replacing `CTRADER_ACCOUNT_BALANCE` env var — it stays as startup seed and fallback

## Decisions

### D1 — Push equity into `CTraderOrderExecutor` via a callback, not a shared object

`index.ts` already wires `CTraderTrader.onAccountUpdate` to push `AccountInfo` into the notifier chain. We extend that callback to also call a setter on the executor: `executor.setLiveBalance(info.balance)`.

**Alternative considered:** Pass a getter function `() => latestBalance` to the executor constructor. Rejected — a push model is simpler and matches the existing pattern; no polling needed.

### D2 — Fall back to `CTRADER_ACCOUNT_BALANCE` env var, not `starting_capital_eur`

On startup, before the first balance poll completes, the executor needs *some* capital figure. The env var `CTRADER_ACCOUNT_BALANCE` is already used as a UI seed in `index.ts`. We reuse it as the executor's initial capital value.

If neither live balance nor env var is available (pure advisory/mock mode), `computeVolume` is never called (auto_execute is false), so no fallback needed there.

### D3 — Keep `daily_risk_pct` in config

`daily_risk_pct` is a strategy parameter chosen by the analyst/operator, not a broker-reported value. It stays in `config.yaml`.

### D4 — Remove `capital.starting_capital_eur` from config entirely (breaking)

Rather than deprecating it, we remove it cleanly. There is only one consumer (this system), and the single config file is easy to update. A deprecation shim would add complexity with no benefit.

## Risks / Trade-offs

- **Startup window** — executor may fire before the first balance poll returns. Mitigated by env-var seed (`CTRADER_ACCOUNT_BALANCE`); if even that is absent and auto_execute fires immediately, `computeVolume` would receive `null` and should return 0 lots (safe — no order placed). Add a guard in the executor.
- **Balance poll lag** — equity used for sizing could be up to 30 s stale. Acceptable; position sizing doesn't need sub-second accuracy.
- **Migration** — existing `config.yaml` files have `starting_capital_eur` and will break on startup until the field is removed. Document clearly in mental notes and the analyst guide.

## Migration Plan

1. Remove `starting_capital_eur` from `config/types.ts` and `config/loader.ts`
2. Add `setLiveBalance(eur: number)` method to `CTraderOrderExecutor`
3. In `index.ts`: seed executor with `CTRADER_ACCOUNT_BALANCE` on construction; call `setLiveBalance` in the `onAccountUpdate` callback
4. Update `config.yaml` (and example files) to remove `starting_capital_eur`
5. Update tests
6. Update docs (`PRD.md`, `ARCHITECTURE.md`, mental notes)

**Rollback:** revert the commit; restore `starting_capital_eur` to config. No DB migration involved.

## Open Questions

- Should we log a warning when `computeVolume` is called with no live balance yet (env-var fallback active)? Probably yes — worth a `warn` so the operator knows the seed is in use.
