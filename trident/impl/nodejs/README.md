# Trident — Node.js / TypeScript Implementation

Canonical reference implementation of the Trident strategy, running as a standalone
Node.js process. This is the Phase 1 POC: it reads a YAML signal file, watches live
prices, applies the Trident mean-reversion logic, and outputs trade events to the
console (or any pluggable notifier).

For full system context see the [Trident PRD](../../docs/PRD.md).

---

## Prerequisites

- **Node.js** ≥ 20 (LTS recommended — `node --version` to check)
- **npm** ≥ 10 (comes with Node)

No other tools required.

---

## Operating assumptions

**One process per Pepperstone / cTrader account.** The engine does not coordinate with other instances. Running two processes against the same account — on the same machine or across machines — causes two known problems:

1. **cTrader token rotation race.** The feed refreshes its OAuth token periodically and writes the new access + refresh token to `.env`. If a second instance holds the old refresh token, it is invalidated server-side the moment the first instance rotates, and the second instance's feed starts failing.
2. **Duplicate advisory notifications.** Each process watches the signals directory and runs its own `TridentEngine`. Every `ENTRY_TRIGGERED` / `POSITION_CLOSED` event fires per-process, and the two engines' views can diverge on tick-timing-sensitive transitions (breakeven, entry fills).

If you need a second console view (e.g., you and a collaborator), run a single engine and fan out its notifications (`MultiNotifier`, Telegram, etc.) rather than running a second process. See [FAQ](./FAQ.md) for detail.

---

## Dev environment setup

```bash
# From the repo root
cd trident/impl/nodejs

# Install dependencies
npm install
```

That's it. No database, no broker connection, no environment variables needed for
development.

---

## Running the tests

```bash
npm test
```

Runs the full test suite once and exits. All business logic (entry calculations, exit
conditions, signal validation) is covered here. Run this after any change to
`src/strategy/` or `src/signal/`.

```bash
npm run test:watch
```

Reruns tests on every file save — useful while developing.

---

## Running the engine

### Mock / demo mode

The fastest way to see the engine working end-to-end. Loads the sample signal file,
patches it to today's date, and plays a scripted price sequence through the full
trade lifecycle:

```bash
npx tsx src/index.ts --mock
```

Expected output walks through: signal load → DVS check → trade setup → three entry
fills → breakeven trigger → VWAP hit → daily lock.

---

### Live mode (real signal file, mock price feed)

Put a signal YAML file in the `signals/` directory and start the engine:

```bash
# Create the signals directory if it doesn't exist
mkdir -p signals

# Copy the sample signal and edit it with today's levels
cp ../../docs/research/sample-signal-files/qs_signal_2026-04-02_1006.yaml \
   signals/qs_signal_$(date +%Y-%m-%d)_1000.yaml

# Start the engine (watches the signals/ directory for new files)
npx tsx src/index.ts
```

The engine picks up any `qs_signal_*.yaml` file dropped into `signals/`. To simulate
an afternoon recalibration, drop a second file with `update_seq: 2`.

Once running, open `http://localhost:3000` to use the built-in **dashboard**: a form
for submitting signals and a live event tail mirroring the console output. The
port is configurable via `TRIDENT_WEB_PORT`. Manual YAML drops still work exactly
as before — the dashboard is an alternative input path, not a replacement.

> **Price feed:** live mode currently has no real price feed wired in. The engine
> watches for signals and validates them, but `onPriceUpdate()` is never called
> without a feed. Plug in a real `PriceFeed` implementation in `src/index.ts` when
> you have a data source (see [Adding a real price feed](#adding-a-real-price-feed)).

---

### Point at a specific signal file on startup

Useful for replaying a historical signal:

```bash
npx tsx src/index.ts --signal ./signals/qs_signal_2026-04-02_1006.yaml
```

The engine validates and loads that file immediately, then continues watching the
signals directory for updates.

---

### Custom config path

```bash
npx tsx src/index.ts --config /path/to/my-config.yaml
```

---

## Project structure

```
src/
  config/
    types.ts          QSConfig interface
    loader.ts         Parses config.yaml
  signal/
    types.ts          SignalFile and related types (mirrors the YAML schema)
    validator.ts      All 15 validation rules from the PRD
    loader.ts         YAML parser + fs.watch directory watcher
  price-feed/
    PriceFeed.ts      Interface — swap implementations without touching the engine
    MockPriceFeed.ts  Scripted tick sequence for testing and demos
    index.ts
  notifier/
    Notifier.ts       Interface + all event types
    ConsoleNotifier.ts Pretty timestamped console output
    index.ts
  strategy/
    types.ts          Direction, EntryLevel, Fill, ActivePosition, etc.
    calculator.ts     Pure functions: entry calc, avg entry, stop, PnL, triggers
    TridentEngine.ts  State machine — the core of the system
  index.ts            CLI entry point

tests/
  calculator.test.ts  15 tests — PRD entry/exit logic
  validator.test.ts   8 tests — signal validation rules

config.yaml           System config (capital, Trident parameters, risk rules)
signals/              Drop signal YAML files here (git-ignored)
```

---

## Configuration

`config.yaml` holds parameters that rarely change. Key values:

| Parameter | Default | Notes |
|---|---|---|
| `trident.dvs_gate` | 75 | No trades if DVS exceeds this |
| `trident.stop_loss_points` | 40 | Hard stop distance from avg entry |
| `trident.breakeven_trigger_points` | 25 | Profit at which stop moves to entry |
| `trident.hard_profit_exit_points` | 33 | Hard close regardless of VWAP |
| `trident.time_exit_minutes` | 180 | Max trade duration from last fill |
| `trident.midpoint_offset_buy` | +2 | Entry 2 shift toward Entry 1 (longs) |
| `trident.midpoint_offset_sell` | -2 | Entry 2 shift toward Entry 1 (shorts) |
| `capital.soft_daily_stop_eur` | 400 | Normal daily loss limit |
| `capital.hard_daily_stop_eur` | 800 | Emergency backstop |

The daily signal file (`qs_signal_*.yaml`) is separate — it holds the analyst's
levels, VWAP, DVS, and bias for that session.

---

## Adding a real price feed

1. Create a class in `src/price-feed/` that implements the `PriceFeed` interface:

```typescript
import type { PriceFeed } from './PriceFeed.js';

export class DatabentoPriceFeed implements PriceFeed {
  async connect(): Promise<void> { /* open WebSocket */ }
  async disconnect(): Promise<void> { /* close */ }
  subscribe(callback: (price: number) => void): void { /* register callback */ }
  getLatestPrice(): number | null { /* return last known price */ }
}
```

2. Export it from `src/price-feed/index.ts`.

3. In `src/index.ts`, replace `MockPriceFeed` with your implementation and wire
   it to the engine:

```typescript
const feed = new DatabentoPriceFeed({ symbol: 'ES.c.0', /* ...auth */ });
feed.subscribe(price => engine.onPriceUpdate(price));
await feed.connect();
```

The engine never imports a concrete feed — only the interface — so the rest of the
code is untouched.

---

## Logging

The engine uses [Winston](https://github.com/winstonjs/winston) for structured logging. There are two outputs:

| Output | Format | Purpose |
|---|---|---|
| Console | Colored, human-readable | Operator / dev visibility |
| `logs/trident.log` | JSON lines | Audit trail — every decision recorded |

Log levels (controlled by the `LOG_LEVEL` env var):

| Level | What you see |
|---|---|
| `error` | System failures, invalid configs |
| `warn` | DVS gate, stale data, validation failures, stop hit |
| `info` | Signal loaded, DVS check result, entries filled, exits, daily lock *(default)* |
| `debug` | Every price tick, trigger checks, state transitions, timer resets |

```bash
# Default (info) — operational milestones only
npx tsx src/index.ts --mock

# Debug — full decision trace (noisy but useful when diagnosing)
LOG_LEVEL=debug npx tsx src/index.ts --mock

# Warn — suppress system logs; only trader-facing ConsoleNotifier output remains
LOG_LEVEL=warn npx tsx src/index.ts --mock
```

The console logger and the `ConsoleNotifier` are intentionally separate:
- **ConsoleNotifier** — trader-facing events, formatted for readability (`[ENTRY 1] SHORT @ 6582.50`)
- **Logger** — operator-facing decisions with structured metadata (`Entry 1 trigger check: price 6582.50 >= 6582.00 → TRIGGERED`)

At `LOG_LEVEL=warn`, the logger goes quiet and only the clean notifier output remains — useful once the system is stable and you want less noise.

---

## Adding a notifier (e.g. Telegram)

Same pattern:

1. Create `src/notifier/TelegramNotifier.ts` implementing the `Notifier` interface.
2. In `src/index.ts`, swap `new ConsoleNotifier()` for `new TelegramNotifier(token, chatId)`.
3. Both can run at once by wrapping them: `new MultiNotifier([console, telegram])`.
