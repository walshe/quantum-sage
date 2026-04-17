# Developer Mental Notes — Trident Signal Engine

A plain-English walkthrough of the codebase, starting from `src/index.ts` and
following the flow outward. Written for the developer who built it and wants a
quick refresher, not a stranger reading docs for the first time.

---

## Entry point — `src/index.ts`

This is where the process starts. Three things happen here before anything
trading-related runs:

1. **Read CLI args** — `--config`, `--mock`, `--signal`. Nothing fancy, just
   `process.argv`. Lets you point at a different config file or kick off a demo
   without touching code.

2. **Load config** — calls `loadConfig()` with the path to `config.yaml`. This
   gives you the `QSConfig` object that everything else reads from: capital
   amounts, stop distances, entry allocations, the DVS gate threshold, etc.
   These are the knobs that rarely change.

3. **Wire up the three core objects** and hand them to each other:
   - `ConsoleNotifier` — the output channel (swap this for Telegram later)
   - `TridentEngine` — the brain, takes config and notifier
   - Signal watcher / mock feed — the input

After that it either runs the mock scenario (scripted prices, good for demos and
development) or starts watching the `signals/` directory for real YAML files.

> **Mental model:** index.ts is the plug board. It doesn't contain any business
> logic — it just connects the right parts together.

---

## Config — `src/config/`

### `types.ts`
Just a TypeScript interface — `QSConfig`. Describes exactly what shape
`config.yaml` must have. No logic here, just the contract.

### `loader.ts`
Reads `config.yaml` off disk using `js-yaml`, casts it to `QSConfig`, then does
one sanity check: the three entry allocations must sum to 100. If they don't, it
throws immediately rather than letting a bad config silently produce wrong
position sizes later.

> **Why it exists:** the config rarely changes but it's the source of truth for
> all the numbers the engine uses. Keeping it in a YAML file (not hardcoded)
> means you can tune parameters — midpoint offset, time exit, stop distance —
> without touching code.

---

## Signal file — `src/signal/`

The signal file is the daily YAML that the analyst (FB) drops in. It carries the
levels, VWAP, DVS, bias, and invalidation boundaries for that session. This whole
folder is about reading and trusting (or rejecting) that file.

### `types.ts`
TypeScript interfaces mirroring the YAML schema exactly — `SignalFile`,
`SignalMeta`, `SignalLevels`, etc. Also defines `ActiveLevels`, which is a
trimmed-down version of the levels section that the engine actually works with
(morning or recalibrated, whichever applies).

### `validator.ts`
This is the gatekeeper. Takes a parsed `SignalFile` and runs 15 checks against
it. Things like: are the range boundaries in the right order, does the basis math
add up, is the DVS within a sane range, is the file too old, is VWAP suspiciously
stale. Returns `{ valid, errors, warnings }` — errors block trading, warnings
just log.

The validator is the only place where untrusted external data (the YAML) gets
challenged. If it passes here, the rest of the engine trusts the numbers.

### `loader.ts`
Two functions:
- `loadSignalFile(path)` — reads a YAML file off disk and returns a raw
  `SignalFile`. No validation here, just parsing.
- `watchSignalDir(dir, callback)` — sets up a filesystem watcher on the
  `signals/` directory. Whenever a file matching `qs_signal_*.yaml` appears or
  changes, it calls `loadSignalFile` and fires the callback. Returns a cleanup
  function to stop watching.

> **Mental model:** the loader is just a pipe. It gets bytes off disk and turns
> them into objects. The validator decides if those objects are trustworthy.

---

## Price feed — `src/price-feed/`

### `PriceFeed.ts` (interface)
Four methods: `connect()`, `disconnect()`, `subscribe(callback)`,
`getLatestPrice()`. That's the entire contract any price feed must satisfy.
The engine only ever talks to this interface — it has no idea whether prices are
coming from a mock, Databento, IBKR, or anything else.

### `MockPriceFeed.ts`
Takes an array of `{ price, delayMs }` ticks in the constructor. When you call
`connect()` it plays through them one by one, waiting `delayMs` between each,
firing the subscriber callback each time. When all ticks are played, it stops.

Used in the `--mock` demo and in any future integration tests that want to
simulate specific price scenarios without a live feed.

> **Mental model:** the mock is a recorded script. Give it a sequence of prices
> and it plays them back at whatever speed you want.

### `CTraderPriceFeed.ts`
The real price feed. Connects to the cTrader Open API over a WebSocket
(`wss://live1.p.ctrader.com:5036`) using the JSON protocol (port 5036 — no
protobuf dependency needed).

**Config it needs** (all read from `.env` via `index.ts`):
- `clientId` / `clientSecret` — your cTrader app credentials
- `accessToken` — obtained once via `npm run auth:ctrader`, stored in `.env`
- `symbolName` — e.g. `"US500"` — the instrument to subscribe to
- `accountId` (optional) — if omitted, picks the first live account automatically

**What `connect()` does** — drives a five-step handshake over the open socket,
then resolves:
1. **App auth** — sends client ID + secret (`payloadType 2100`). Proves this is
   a registered cTrader application.
2. **Get account list** — exchanges the access token for a list of trading
   accounts (`payloadType 2149`). Resolves the `ctidTraderAccountId` the engine
   will trade on.
3. **Account auth** — authorises the chosen account for this session
   (`payloadType 2102`).
4. **Symbol list** — fetches every symbol available on the account
   (`payloadType 2115`) and finds the `symbolId` that matches `symbolName`. If
   the name doesn't match anything exactly, it tries a prefix match. If still
   nothing, `connect()` rejects with an error listing the first 20 available
   symbols — useful for figuring out what FB's broker calls the instrument.
5. **Subscribe spots** — subscribes to the real-time bid/ask stream for that
   symbol (`payloadType 2119`). Once the confirmation arrives, `connect()`
   resolves and ticks start flowing.

**Prices**: cTrader sends bid and ask as integers (actual price × 100,000).
The feed divides by 100,000 and delivers the mid-price `(bid + ask) / 2`
rounded to 2 decimal places. Bid and ask can also arrive in separate events
(partial updates), so the feed holds on to the last seen value of each side and
only fires the subscriber once both are known.

**Keep-alive**: sends a heartbeat (`payloadType 0`) every 10 seconds as required
by the API. Stopped on `disconnect()`.

**`disconnect()`** — sends an unsubscribe message to cancel the spot stream
cleanly, then closes the WebSocket.

**`index.ts` wiring**: the feed is only created if `CTRADER_CLIENT_ID`,
`CTRADER_CLIENT_SECRET`, and `CTRADER_ACCESS_TOKEN` are all present in the
environment. If any are missing, the engine starts without a price feed and
prints a reminder to run `auth:ctrader`. The optional `CTRADER_SYMBOL` env var
controls the symbol name (default: `US500`).

> **Mental model:** the feed does the whole cTrader ceremony so the engine
> doesn't have to know anything about WebSockets or OAuth. Once `connect()`
> resolves, it's just a stream of numbers — identical to the mock from the
> engine's point of view.

---

## Notifier — `src/notifier/`

### `Notifier.ts` (interface + event types)
Defines the `Notifier` interface (one method: `notify(event)`), and the union
type `NotificationEvent` — a discriminated union of every event the engine can
emit. Things like `ENTRY_TRIGGERED`, `BREAKEVEN_TRIGGERED`, `POSITION_CLOSED`,
`DVS_GATE_BLOCKED`, etc.

Every event carries the data that makes sense for it: an entry event carries the
fill price, direction, allocation, avg entry, stop. A close event carries the
reason, P&L in points. The notifier implementation decides what to do with each.

### `ConsoleNotifier.ts`
The simple implementation. Handles each event type with a `switch`, formats it
into a readable line, and `console.log`s it. Timestamps every line. The
`showPriceTicks` flag controls whether every price update is printed (off by
default, very noisy).

> **Mental model:** the notifier is the voice of the engine. The engine fires
> events; the notifier decides how to communicate them. Swap `ConsoleNotifier`
> for `TelegramNotifier` and the engine doesn't change at all.

---

## Logger — `src/logger.ts`

Separate from the notifier. The notifier is for **trader-facing events** ("entry
filled"). The logger is for **operator/developer visibility** ("why did the engine
make that decision, what did it read, what did it check").

Uses Winston with two outputs:
- **Console** — colored, timestamped, module-labelled. Controlled by `LOG_LEVEL`
  env var (default: `info`).
- **File** — JSON lines written to `logs/trident.log`. Full audit trail, every
  decision recorded.

`getLogger('ModuleName')` returns a child logger with a `module` label, so you
can see in the output exactly which part of the code logged what.

Set `LOG_LEVEL=debug` to see every price tick and trigger check. Set
`LOG_LEVEL=warn` to suppress system logs and see only clean notifier output.

---

## Strategy — `src/strategy/`

This is the core. Everything above is plumbing; this is the thing that actually
knows how to trade.

### `types.ts`
The data structures the engine lives in:
- `Direction` — `'long'` or `'short'`
- `EntryLevel` — entry number (1/2/3), price, allocation %
- `Fill` — a confirmed fill: entry number, price, allocation, timestamp
- `PositionState` — the state machine states: `idle`, `blocked`, `watching`,
  `in_trade`, `closed`
- `ActivePosition` — the live trade: direction, fills so far, pending entries,
  avg entry, current stop, VWAP target, last fill time, breakeven flag

### `calculator.ts`
Pure functions, no state, no side effects. Easy to unit test in isolation.
- `calculateEntries()` — takes the two levels from the signal (inner and outer)
  and produces the three entry prices: Entry 1 = inner, Entry 3 = outer, Entry 2
  = midpoint ± the configured offset.
- `calculateAvgEntry()` — weighted average of fills so far.
- `calculateStop()` — stop price = avg entry ± stop distance (40 pts).
- `pnlPoints()` — current unrealised P&L in points from the current price.
- `isEntryTriggered()`, `isStopHit()`, `isVwapHit()` — simple comparisons that
  account for direction. Longs trigger when price falls to a level; shorts when
  it rises.

> **Mental model:** calculator.ts is the maths. TridentEngine.ts is the
> decisions. Keeping them separate means you can test all the maths without
> needing an engine running.

### `TridentEngine.ts`
The state machine. The most important file in the project.

**State it holds:**
- Which state it's in (`idle` → `watching` → `in_trade` → `closed`)
- The current signal (levels, VWAP, invalidation)
- The active levels resolved from the signal (morning or recal)
- The trade setup (three calculated entry prices)
- The active position (fills, avg entry, stop, breakeven flag)
- Whether today is locked (one winning trade already closed)
- A timer handle for the 180-minute time exit

**`loadSignal(signal, filePath)`** — called whenever a new signal file arrives.
Runs the validator. If valid: checks the DVS gate, resolves active levels, calls
`setupTrade()`. If a trade is already active, ignores the new levels (doesn't
disrupt the open trade). If daily lock is on, also ignores.

**`setupTrade()`** — looks at available levels and bias to decide direction. If
both sides are available, uses the bias direction; falls back to long. Calculates
the three entry prices using the calculator, sets state to `watching`, fires
`SETUP_READY` to the notifier.

**`onPriceUpdate(price)`** — called on every price tick from the feed. This is
the main loop. In order:
1. Fires `PRICE_UPDATE` to the notifier (suppressed by default).
2. If not watching or in trade, returns immediately.
3. Checks invalidation boundaries — if price breaks out of the void range, closes
   everything.
4. Checks expiry — if past the signal's expiry time, closes everything.
5. If `watching`: checks whether Entry 1 has been triggered.
6. If `in_trade`: checks exit conditions first (stop, VWAP, +33 hard exit, +25
   breakeven), then checks pending entries (Entry 2, Entry 3).

**`fillEntry()`** — called when an entry triggers. Creates a `Fill`, updates or
creates the `ActivePosition`, recalculates avg entry and stop, resets the 180-min
timer, fires `ENTRY_TRIGGERED` to the notifier.

**`checkExitConditions()`** — called every tick while in a trade. Checks in
priority order: stop hit → close; VWAP hit → close; +33 pts → close; +25 pts →
activate breakeven (move stop, cancel pending entries, don't close).

**`closePosition()`** — tears down the position, cancels the timer, fires
`POSITION_CLOSED`. If it was a win, calls `applyDailyLock()`.

**Time exit timer** — reset every time a new entry fills (the 180 minutes counts
from the *last* fill, per the PRD). If it fires, closes the position at whatever
the latest price is.

---

## How it all connects — the happy path

```
index.ts boots
  → loadConfig()            reads config.yaml
  → new TridentEngine()     engine created, sitting in 'idle'
  → watchSignalDir()        fs.watch on signals/ directory

FB drops qs_signal_2026-04-13_1006.yaml into signals/
  → loader detects file change
  → loadSignalFile()        parses YAML
  → engine.loadSignal()     validates → DVS check → resolve levels → setupTrade()
  → engine state: 'watching'
  → notifier fires SETUP_READY

Price feed delivers ticks to engine.onPriceUpdate()
  → each tick: check invalidation, check expiry, check Entry 1 trigger
  → price hits MAX SELL 2 (6582)
  → fillEntry(entry1)       position opened, timer started
  → notifier fires ENTRY_TRIGGERED

  → price hits midpoint (6597)
  → fillEntry(entry2)       avg entry recalculated, stop recalculated, timer reset
  → notifier fires ENTRY_TRIGGERED

  → price hits MAX SELL 1 (6616)
  → fillEntry(entry3)       fully scaled in, timer reset
  → notifier fires ENTRY_TRIGGERED

  → price falls to avg_entry - 25 (breakeven zone)
  → breakeven activates     stop moves to avg entry, pending entries cancelled
  → notifier fires BREAKEVEN_TRIGGERED

  → price falls to VWAP (6555)
  → closePosition()         WIN, fires POSITION_CLOSED
  → applyDailyLock()        no more trades today
  → notifier fires DAILY_LOCK
```

---

## Key design decisions worth remembering

- **The engine never imports a concrete feed or notifier.** Only interfaces. Swap
  implementations in `index.ts` without touching strategy logic.
- **The validator is the only trust boundary.** Once a signal passes validation,
  the engine treats all values as correct.
- **Calculator functions are pure.** All the maths is side-effect free and tested
  independently of the engine.
- **One engine instance per day.** Call `engine.reset()` at the start of a new
  session. The daily lock, position state, and signal are all cleared.
- **The notifier and the logger serve different audiences.** Notifier = trader
  (what happened). Logger = developer/operator (why it happened).
