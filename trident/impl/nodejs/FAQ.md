# Trident FAQ

Operational questions about the qs-signal-engine and what it does (and doesn't do) in edge cases.

Reminder: this app is a **signal/notification engine**, not an order-execution engine. It watches YAML signal files, consumes a cTrader price feed, and emits notifications (console today, Telegram later) describing what a trade would do. The analyst places orders with their broker manually.

> **Operating proviso.** The answers below assume only one engine process runs per Pepperstone / cTrader account at a time. That single-process guarantee is a deliberate constraint — see README "Operating assumptions" and Q2 below.

---

## 1. What happens if there's a trade on and the app crashes and is manually restarted?

### Short answer
The engine restores its last-known state from disk and resumes where it left off. The open position, the daily lock, and the current signal are all recovered. The time-exit deadline is honoured across the downtime.

### How it works
On every meaningful state transition (signal load, trade setup, entry fill, breakeven, position close, daily lock, reset), `TridentEngine` writes a full snapshot to `logs/engine-state.json` using an atomic write:

1. write JSON to `logs/engine-state.json.tmp`
2. `fsync` it to disk
3. `rename` over the target

A crash between any two steps leaves either the old snapshot intact or nothing at all — the target file can never be corrupt.

On startup the engine reads the snapshot and rehydrates:

- `state`, `dailyLocked`, `currentSignal`, active levels, trade setup, position (including fills, avg entry, current stop, breakeven flag, VWAP target, `lastFillTime`).
- The 180-minute time-exit timer is recomputed from `lastFillTime + time_exit_minutes` and rescheduled with the remaining time.
- If the deadline elapsed *during* the downtime, the engine flags it and closes the position with reason `time_exit` on the next price tick (see `onPriceUpdate` safety net).

### What doesn't get restored
- **Snapshots from a previous trading day are discarded.** Each calendar day starts fresh — the daily lock is per-day, and yesterday's position is no longer relevant.
- **Signal files in the watch directory are still not replayed on startup** — `fs.watch` only fires on new change events. The snapshot covers the "there was a loaded signal / in-flight trade" case, which is the important one.
- Version mismatches (`version` field in the snapshot) or malformed JSON cause the snapshot to be ignored with a log entry; the engine starts clean rather than hydrate into an unknown state.

### Caveats
- **Broker position still isn't managed by the app.** If the analyst had entered an order at Pepperstone based on a prior notification, that order is untouched by the crash or the restore — the app has no execution path.
- **Disabled in `--mock` mode.** Demo runs pass `snapshotPath: null` so they don't pollute (or restore from) the live snapshot file.

### Files involved
- `src/strategy/persistence.ts` — snapshot encode/decode, atomic save, staleness/version checks
- `src/strategy/TridentEngine.ts` — `hydrateFromSnapshot`, `persist()` calls at each transition, time-exit rehydration
- `tests/persistence.test.ts` — round-trip, stale-day rejection, engine hydration integration

---

## 2. What happens if two instances of the app are started accidentally?

### Short answer
Don't do it. The app assumes one process per Pepperstone account (see proviso at the top). Nothing in the code enforces this today, so a second process will run — and it will cause two distinct problems.

### Problem 1: cTrader token rotation race
The cTrader feed refreshes its OAuth access token periodically and persists the new access + refresh token pair back to `.env` via `writeEnvKey` in `src/index.ts`. With two instances (same machine or different machines sharing the same tokens):

- Both start with the same access + refresh token.
- Instance A refreshes first. cTrader issues a new access token and a **new refresh token**, and invalidates the old refresh token server-side. A writes the new pair to `.env`.
- Instance B still holds the old refresh token in memory. When its refresh timer fires, it presents a now-invalid refresh token and gets rejected. Its feed fails and its reconnect loop starts spinning.

Net result: silent token churn, repeated auth failures, and unreliable price data for at least one of the instances.

### Problem 2: duplicate advisory notifications and divergent state
Each process runs its own `TridentEngine` with its own in-memory view. `fs.watch` fires in both processes when a signal YAML changes, so every `SETUP_READY`, `ENTRY_TRIGGERED`, `BREAKEVEN_TRIGGERED`, and `POSITION_CLOSED` event is emitted twice. Worse, tick-timing jitter between the two processes can cause their state machines to diverge (one hits breakeven on a tick the other missed).

**Note on the snapshot file:** the persistence mechanism added for Q1 does not coordinate multiple writers. If two processes used the same `logs/engine-state.json`, they would each overwrite the other's view on every transition. The single-process proviso is what keeps this simple.

### If you need a second console view
Run a single engine and fan notifications out via `MultiNotifier` (console + Telegram, or console + file). This is the sanctioned way to have two humans watching the same engine.

### Not implemented today
A single-instance lockfile (write a PID file at startup, check for a live process, exit cleanly if one is already running) would turn the proviso into an enforced guarantee. Left out for now to keep the POC small.

---

## Summary table

| Scenario | State persisted? | Daily lock survives? | Time-exit honoured? | Broker position affected? |
|---|---|---|---|---|
| Crash + restart (same day) | Yes (`logs/engine-state.json`) | Yes | Yes, across downtime | No (app never executes) |
| Restart on a new trading day | No (snapshot discarded) | No (intentionally — daily reset) | N/A | No |
| Two instances running | Per-process, uncoordinated | Per-process | Per-process | No — but see token-rotation race |
