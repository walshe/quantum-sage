# Developer Mental Notes — Trident Engine

A plain-English walkthrough of the codebase, starting from `src/index.ts` and
following the flow outward. Written for the developer who built it and wants a
quick refresher, not a stranger reading docs for the first time.

---

## Entry point — `src/index.ts`

Where the process starts. Boot order:

1. **Read CLI args** — `--config`, `--mock`, `--signal`. Nothing fancy, just
   `process.argv`. Lets you point at a different config file or kick off a demo
   without touching code.

2. **Load config** — `loadConfig()` reads `config.yaml` and returns the
   `QSConfig` object: capital amounts, stop distances, entry allocations, DVS
   gate threshold, time-exit, etc.

3. **Wire up the components**:
   - `ConsoleNotifier` — terminal output channel.
   - `MultiNotifier` — fan-out wrapper holding a mutable list of children.
     Initially `[ConsoleNotifier]`; the `WebSocketNotifier` is appended once
     the web server boots so engine events also stream to browsers.
   - `TridentEngine` — the brain. Takes config + the MultiNotifier and a
     `snapshotPath` (`logs/engine-state.json` by default; `null` for `--mock`).
     Constructor automatically hydrates from a same-day snapshot if present.

4. **`--mock` branch**: load the sample YAML, run a scripted `MockPriceFeed`
   through `engine.onPriceUpdate`, exit. No web server, no persistence.

5. **Live branch**: in this order
   - Start the web server (`startWebServer`) and append its
     `WebSocketNotifier` to the MultiNotifier — done **before** connecting
     cTrader so the dashboard is responsive even if the broker is down.
   - Build a `CTraderPriceFeed` if `CTRADER_CLIENT_ID/SECRET/ACCESS_TOKEN` are
     set. Subscribe its callback to `engine.onPriceUpdate`. `connectWithRetry`
     loops indefinitely with a 5s backoff so a transient drop doesn't kill the
     engine. The feed has an `onTokenRefresh` callback that writes refreshed
     tokens back into `.env` via `writeEnvKey`.
   - If `--signal <path>` was passed, load it directly.
   - Start `watchSignalDir` for live drops, then `scanSignalDirOnce` so a
     setup written while the engine was down still gets picked up.

6. **Shutdown**: SIGINT/SIGTERM trigger `shutdown()` which stops the watcher,
   closes the web server, and disconnects the feed. A 5s `setTimeout(...).unref()`
   forces exit if any close handler hangs. Second Ctrl-C bails immediately.

> **Mental model:** index.ts is the plug board. It doesn't contain any business
> logic — it just connects the right parts together in the right order.

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

### Position sizing model (current + future)

**Current model:** The engine is purely advisory — it outputs percentage instructions and the trader places orders manually at the broker.

- `starting_capital_eur` × `daily_risk_pct` = total daily risk budget (e.g. €80k × 0.5% = €400 soft stop).
- Entry allocation splits (32.5/35/32.5%) are *weights* dividing that budget across the three scale-in entries — not independently-sized positions.
- `size_adaptation` multipliers (0.5× after one losing day, 0.25× after two) are wired into config but **not yet implemented** in the engine — they belong in the daily P&L tracking pass, which doesn't exist yet.
- Notifications say "32.5% size"; the trader manually converts that to lots at the broker.

**Future — contract count advice:** When the engine starts computing suggested lot counts it will need:
- A `point_value_eur` config field: the notional EUR value per index point per lot for the execution instrument (e.g. ~€1/pt for the US500.cash Pepperstone CFD — confirm with FB).
- Formula: `contracts = floor((capital × risk_pct × entry_alloc_pct) / (stop_loss_points × point_value_eur))`.
- At that point `starting_capital_eur` will drift as P&L accumulates and produce stale sizing advice. The correct fix is to pull **live account equity from cTrader** via an account-info API call (separate from the price-feed subscription, which is read-only ticks). Implement static config first, add live balance once the API surface is understood.

---

## Setup file — `src/signal/`

The setup file is the daily YAML that the analyst (FB) submits. It carries the
levels, VWAP, DVS, bias, and invalidation boundaries for that session. This whole
folder is about reading and trusting (or rejecting) that file.

### `types.ts`
TypeScript interfaces mirroring the YAML schema exactly — `SignalFile`,
`SignalMeta`, `SignalLevels`, etc. Also defines `ActiveLevels`, which is a
trimmed-down version of the levels section that the engine actually works with
(morning or recalibrated, whichever applies).

### `validator.ts`
This is the gatekeeper. Takes a parsed `SignalFile` and runs the full set of
trust checks: schema version, required sections, range/buy/sell ordering,
**at least one tradeable level pair (both BUY INNER+OUTER or both SELL INNER+OUTER)**,
price sanity (within 20% of `futures_last`), basis range and basis math,
DVS range, VWAP presence, invalidation boundaries bracket `futures_last`,
enum values (regime/instrument/direction/confidence), timestamp before
expiry, setup staleness, and VWAP staleness (warning only). Returns
`{ valid, errors, warnings }` — errors block trading, warnings just log.

The validator runs in two places that matter:
- The web server's `POST /signals` endpoint, so a bad submission is rejected
  before it's ever written to `setups/`.
- `TridentEngine.loadSignal`, so a hand-written or fs.watch-detected setup file
  that bypasses the web UI gets the same treatment.

The validator is the only place where untrusted external data (the YAML) gets
challenged. If it passes here, the rest of the engine trusts the numbers.

### `loader.ts`
Three functions:
- `loadSignalFile(path)` — reads a YAML file off disk and returns a raw
  `SignalFile`. No validation here, just parsing.
- `watchSignalDir(dir, callback)` — sets up a filesystem watcher on the
  `setups/` directory. Whenever a file matching `qs_setup_*.yaml` appears or
  changes, it calls `loadSignalFile` and fires the callback. Returns a cleanup
  function to stop watching.
- `scanSignalDirOnce(dir, callback)` — one-shot scan over today's existing
  setup files. Runs at boot so a YAML written during a downtime window isn't
  orphaned by `fs.watch`'s "events from now on only" semantics.

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
prints a reminder to run `auth:ctrader`. Optional env vars: `CTRADER_SYMBOL`
(default `US500`), `CTRADER_ACCOUNT_ID`, `CTRADER_WS_URL` (set for demo),
`CTRADER_NO_HEARTBEAT=true` (also for demo), `CTRADER_SYMBOL_ID` (skip the
symbol-list lookup if your environment doesn't support it).

**Token refresh** is handled by the feed itself: `CTRADER_REFRESH_TOKEN` and
`CTRADER_TOKEN_EXPIRES_AT` are read on connect, and an `onTokenRefresh`
callback writes the new triple back into `.env` via `writeEnvKey()` so the
next process start sees fresh credentials.

**Reconnect**: `index.ts` wraps `connect()` in a `connectWithRetry` loop
that re-creates the feed and resubscribes after every failure with a 5-second
backoff. The cTrader demo server drops idle connections after ~60s, so this
matters for development. Indefinite retry, no exponential backoff —
deliberately simple.

> **Blind-during-disconnect risk**: `TridentEngine` is never torn down on feed
> loss — state (`watching`, `in_trade`, etc.) is preserved across reconnects.
> But while disconnected the engine receives no ticks, so stop/target/invalidation
> checks are frozen. The 180-minute time-exit timer keeps running. If it fires
> during an outage, `closePosition()` executes using the last known price, not
> the actual market price. For short outages (seconds) this is fine. For longer
> ones (minutes) while a trade is open, the trader should check the position
> manually. There is no alerting for this today — the `trident_feed_connected`
> metric (added in the observability layer) is the intended signal.

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

### `LoggerNotifier.ts`
Sits on the `MultiNotifier` chain alongside `ConsoleNotifier` — always active.
Logs every engine event as structured JSON via winston (suppressing `PRICE_UPDATE`).
Each entry carries `event` (the event type) as the primary discriminator, plus
the relevant fields. Broker-action events (`ENTRY_TRIGGERED`, `BREAKEVEN_TRIGGERED`,
`POSITION_CLOSED`) also carry an `action` field with the broker instruction text.

Key design choice: `event` is the discriminator, not a boolean `action_required`.
This survives Phase 2 (auto-execution) cleanly — the three event types still fire
when execution transitions from manual to automatic; only the `action` text evolves.
Loki alert query: `{service="trident"} | json | event =~ "ENTRY_TRIGGERED|BREAKEVEN_TRIGGERED|POSITION_CLOSED"`.

### `MultiNotifier.ts`
Fan-out wrapper. `notify(event)` runs every child's `notify` via
`Promise.allSettled` so one child throwing doesn't block the others — the
error is logged and the rest still receive the event. The children list is
mutable from the outside so `index.ts` can append `WebSocketNotifier` *after*
the web server is up without restructuring the engine.

### `WebSocketNotifier.ts`
Bridges engine events to connected browser tabs over a `ws` server (mounted at
`/events` by the web server module). On every new client it sends a
`{ kind: 'bootstrap', data }` envelope with current engine state — drives the
status band on a freshly-opened tab. Subsequent events go out as
`{ kind: 'event', data }`. `PRICE_UPDATE` events are throttled (default
500ms) so a quiet UI doesn't get hammered by tick frequency.

### `eventFormatter.ts`
Pure function that turns a `NotificationEvent` into the row shape the web
client expects (`{ tag, severity, head, lines, action }`). Shared between
the WebSocket notifier and any other formatter that wants the same string
shape; keeps presentation out of the notifier transport.

> **Mental model:** the notifier is the voice of the engine. The engine fires
> events; each notifier decides how to communicate them. Add a Telegram
> notifier and you just push it onto the MultiNotifier's children — the engine
> doesn't change.

---

## Logger — `src/logger.ts`

Separate from the notifier. The notifier is for **trader-facing events** ("entry
filled"). The logger is for **operator/developer visibility** ("why did the engine
make that decision, what did it read, what did it check").

Uses Winston with two outputs:
- **Console** — format depends on the runtime context:
  - **TTY (local terminal)**: colored, timestamped, module-labelled — readable for `npm run dev`.
  - **Non-TTY (Docker container, pipe)**: JSON lines — each field (level, module, message, metadata) is queryable in Loki / Grafana Logs Drilldown.
  Controlled by `LOG_LEVEL` env var (default: `info`).
- **File** — JSON lines written to `logs/trident.log`. Full audit trail, every
  decision recorded.

`getLogger('ModuleName')` returns a child logger with a `module` label, so you
can see in the output exactly which part of the code logged what.

Set `LOG_LEVEL=debug` to see every price tick and trigger check. Set
`LOG_LEVEL=warn` to suppress system logs and see only clean notifier output.

**Note:** `console.log` calls in `src/index.ts` for operational startup messages
have been converted to `log.info/warn/error` so they also appear as structured
JSON in Docker. The `ConsoleNotifier` (trader-facing events) still uses
`console.log` with its own formatting — intentionally separate.

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
- `calculateEntries()` — takes the two levels from the setup (inner and outer)
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
- Which state it's in (`idle` → `watching` → `in_trade` → `closed`, plus
  `blocked` for DVS-gated days)
- The current setup (levels, VWAP, invalidation)
- The active levels resolved from the setup (morning or recal)
- The trade setup (three calculated entry prices)
- The active position (fills, avg entry, stop, breakeven flag)
- Whether today is locked (one winning trade already closed)
- A timer handle for the 180-minute time exit

**Snapshot integration.** Constructor takes a `snapshotPath` (default
`logs/engine-state.json`, `null` to disable for mock/test runs).
On boot, `hydrateFromSnapshot` loads a same-day snapshot if one exists and
restores state, position, daily lock, etc. If a position was open, it
re-schedules the time-exit timer with the *remaining* duration; if the
deadline already passed during downtime, the next price tick force-closes
as `time_exit`. After every meaningful state transition the engine calls
`persist()` to write a fresh snapshot atomically.

**`loadSignal(signal, filePath)`** — called whenever a new setup file arrives.
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
4. Checks expiry — if past the setup's expiry time, closes everything.
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
the latest price is. Note: the timer keeps running during a feed disconnection —
see the *Blind-during-disconnect risk* note in the `CTraderPriceFeed` section.

### `persistence.ts`
Engine-state crash-recovery. Writes a versioned JSON snapshot
(`SNAPSHOT_VERSION = 1`) atomically: tmp file → fsync → rename, so a
mid-write crash can never produce a corrupt file. The snapshot stamps
`date: todayStr()`; `loadSnapshot` discards any snapshot whose date isn't
today and unlinks it (fresh start each session — daily lock is per-day).

`buildSnapshot` / `serializePosition` flatten `Date` → ISO string;
`loadSnapshot` / `deserializePosition` rehydrate them. `clearSnapshot`
removes the file when the engine resets explicitly.

> **Mental model:** persistence is engine-shaped, not file-shaped. The snapshot
> mirrors the engine's in-memory state 1:1. If you add a field to the engine
> and want it to survive a restart, add it here too.

---

## Web server — `src/web/`

Local-only HTTP + WebSocket service that powers the analyst dashboard. Boots
before the price feed so the UI is responsive even when cTrader is down.

### `server.ts`
Express app with four endpoints plus a WebSocket:

- `GET /` — serves `public/index.html`.
- `GET /assets/...` — static files from `public/`.
- `POST /signals` — accepts a JSON setup payload, runs `validateSignal`, and
  on success writes the YAML atomically (tmp + rename) into `signalsDir`.
  Filename is derived from `meta.date` + `meta.timestamp`. Validation errors
  come back as `{ valid: false, errors, warnings }` with status 400.
- `GET /signals/latest` — returns the most recent same-day setup YAML for the
  Pre-fill button. 204 if there isn't one.
- `POST /signals/screenshots` — raw binary upload (one file per call) that
  saves the image into `screenshots/` with a timestamped filename. Used by
  the Import-from-screenshots flow.
- `POST /signals/extract` — JSON `{ filenames: [...] }` (max 3). Loads the
  saved screenshots, runs them through the configured `SignalExtractor`,
  and returns the partial setup payload plus notes/warnings. 503 if the
  provider isn't configured (no API key); the UI degrades to "AI
  extraction unavailable" without breaking.
- `GET ws://.../events` — engine event stream + bootstrap envelope. Backed
  by the `WebSocketNotifier` that's returned from `startWebServer` and
  appended to the engine's MultiNotifier.

The provider is built once at server startup (`buildVisionProvider()`)
so a missing key produces an immediate log line — operators don't
discover the misconfiguration mid-session when an analyst clicks Import.

### `public/`
The vanilla-JS, no-build dashboard. `index.html`, `styles.css`, `app.js`,
and `i18n.js` (English ↔ Italian dictionary). The client opens the `/events`
WebSocket on load, populates the status band from the bootstrap envelope, and
appends every subsequent event to the live log. The setup form lives in a
modal triggered by the top-bar buttons (`New setup`, `Update during session`,
`Pre-fill from latest`, `Import from screenshots`, `Status`).

> **Mental model:** the web server is read-mostly: the engine is authoritative,
> the dashboard is a window onto it. The only writes from the UI are
> `POST /signals` (setup submission, which goes through the same validator the
> engine uses) and the screenshot uploads.

**Bias filter in `buildTradePlanNote()` (app.js):** the friendly trade-plan
summary skips buy entries when `bias.direction === 'short'` and sell entries
when `bias.direction === 'long'`. The values are `'long'`/`'short'`/`'neutral'`
— never `'bullish'`/`'bearish'`. A past bug used `'bearish'`/`'bullish'` so
the filter never fired; fixed 2026-05-12.

**`cash_last` / `basis` HTML required vs validator null-guard:** both fields
carry `required` in the HTML, so the browser prevents blank submission. The
validator's Rule 8 (basis math) has no null-guard — if `cash_last` is `null`
it coerces to 0, making the check always fail. The `required` attribute is
load-bearing; removing it without adding a null-guard to Rule 8 would expose
the bug. The tooltip text ("leave empty to skip") is aspirational — it describes
intended future behaviour, not the current implementation.

---

## AI extraction — `src/ai/`

Optional. Reads chart screenshots through a vision LLM and returns a partial
setup payload for the analyst to review. Off by default — Trident still loads
YAML setups via the manual flow if AI is unavailable.

### `types.ts`
Three contracts: `ImageInput` (`{ bytes, mimeType, filename? }`),
`ExtractionResult` (partial setup + notes + warnings + provider/model/usage),
and `VisionProvider` (`{ name, model, extractSignal(images, systemPrompt) }`).
Provider implementations swap the SDK without changing anything upstream.

### `providers/index.ts` + `providers/OpenAIProvider.ts`
`buildVisionProvider()` selects from `TRIDENT_AI_PROVIDER` (default `openai`)
and returns `null` if the chosen provider isn't configured (e.g. no
`OPENAI_API_KEY`). Severity of the disable-log depends on whether the operator
*explicitly* asked for a provider — explicit + missing key is `error`, implicit
default + missing key is `info` (operator never asked for AI).

`OpenAIProvider` calls the chat-completions endpoint with the `gpt-4o-*`
vision model, base64-encodes the images, asks for JSON output, and parses
the response into an `ExtractionResult`. Model and base URL overridable via
`OPENAI_MODEL` / `OPENAI_BASE_URL`.

### `signalExtractor.ts`
Orchestration layer. `extract()` runs the full safety pipeline:
1. `checkBeforeCall` (guardrail) — screens `callerKey` for injection patterns.
   Throws `ExtractionBlockedError` if blocked (→ server returns 400).
2. Provider call with the canonical `SIGNAL_EXTRACTION_PROMPT`.
3. `validateExtractionResult()` — runtime shape + range check on the raw
   model response. Throws `OutputValidationError` on failure (→ 502 to client).
4. `normalise()` stamps the fields the model isn't allowed to invent —
   `schema_version: '1.0'`, `meta.execution_instrument: 'US500.cash'`,
   `meta.update_seq: 1`, `levels.additional: []`, `vwap.source: 'manual'` —
   so the result is always loadable into the form.
5. `logLlmCall()` emits a structured `LLM_CALL` log (no raw prompt/response).
6. `recordUsage()` accumulates session metrics.

`flushMetrics()` is called by the shutdown hook in `index.ts` and emits an
`AI_SESSION_METRICS` log entry queryable in Grafana:
```
{service="trident"} | json | event = "AI_SESSION_METRICS"
```

### `guardrail.ts`
Module-level state accumulates per-call stats across the process lifetime.
`checkBeforeCall` now does real injection screening (multi-word phrase matching,
case-insensitive, e.g. "ignore previous instructions") and increments
`injectionBlocks` and `totalCalls`. `recordUsage` accumulates latency samples
and cost for p50/p95 computation. `getMetrics()` returns the full
`SessionMetrics` shape used by `flushMetrics()`.

The `{ allowed: boolean; reason?: string }` decision shape replaces the old
`{ allow: boolean }` — note the field name change if you're reading old git history.

### `outputValidator.ts`
Runtime defence against schema violations that slip through the OpenAI tool
schema enforcement. Checks: numeric fields are not strings, enum fields use
valid values (`bias.direction`, `bias.confidence`, `volatility.regime`),
`dvs` is 0–200, price levels are positive. Emits `OUTPUT_VALIDATION_FAILED`
log entry with `errors: string[]` before throwing.

`VolatilityRegime` values the validator accepts: `compressed`, `normal`,
`elevated`, `extreme` (matches the TypeScript type — the spec doc said `low`
which was incorrect).

### `llmLogger.ts`
Emits one structured `LLM_CALL` log entry per extraction attempt. The cost
rate table (`COST_RATES`) is keyed by model ID — add new models here when a
new provider is wired up. Known models: `gpt-4o-2024-11-20`, `gpt-4o-mini`,
`deepseek-chat`, `deepseek-reasoner`. Unknown models log a `warn` and produce
`estimatedCostUsd: null` — operators will notice in Grafana and add the rate.

### `piiRedactor.ts`
Pure function `piiRedact(text: string): string`. Applied to audit log content
only — never to the actual model input. Patterns: email, formatted phone
numbers, IBAN (min 15-char sequence), 10–19 consecutive digit strings.
Trading prices (4–8 digit numbers with decimals) are not affected.

### `prompts/signalExtractionPrompt.ts`
The system prompt that tells the model what fields to extract and explicitly
forbids invention — missing data must come back `null`. Update this file (not
the provider) to tune extraction behaviour.

**Single-chart workflow (2026-05-12):** analyst uploads ONE IV Smile screenshot.
The model reads the right-panel range rows and populates both `ranges.*` and
`levels.*` from the same four values:
- Range 1 up   → `ranges.range_1_up`   + `levels.max_sell_1` (SELL OUTER)
- Range 2 up   → `ranges.range_2_up`   + `levels.max_sell_2` (SELL INNER)
- Range 2 down → `ranges.range_2_down` + `levels.max_buy_2`  (BUY INNER)
- Range 1 down → `ranges.range_1_down` + `levels.max_buy_1`  (BUY OUTER)

All values are in ES futures terms. The SPX intraday chart is no longer
uploaded; `levels.*` are no longer in SPX cash. The MAX_SCREENSHOTS client
constant is 1 and the HTML file input no longer carries `multiple`.

> **Mental model:** AI is a strictly optional pre-fill helper. The validator
> (not the model) decides whether a setup can be loaded. Injection screening
> and output validation run on every call — the model output is never trusted
> as correct until it clears both.

---

## How it all connects — the happy path

```
index.ts boots
  → loadConfig()            reads config.yaml
  → new MultiNotifier([Console])
  → new TridentEngine()     hydrates from logs/engine-state.json if same-day,
                            else starts in 'idle'
  → startWebServer()        Express + ws on :3000
                            appends WebSocketNotifier to MultiNotifier
  → CTraderPriceFeed        connect-with-retry, refresh tokens to .env
  → scanSignalDirOnce()     pick up any signal written during downtime
  → watchSignalDir()        fs.watch on setups/ directory

FB submits setup via dashboard (POST /signals)
  → server validates the setup payload
  → on success writes qs_setup_<date>_<time>.yaml atomically
  → fs.watch fires
  → loadSignalFile()        parses YAML
  → engine.loadSignal()     validates → DVS check → resolve levels → setupTrade()
  → engine state: 'watching' → persist()
  → notifier fan-out fires SETUP_READY (console + browser tabs)

Price feed delivers ticks to engine.onPriceUpdate()
  → each tick: check invalidation, check expiry, check Entry 1 trigger
  → price hits SELL INNER/max_sell_2 (6582)
  → fillEntry(entry1)       position opened, timer started
  → notifier fires ENTRY_TRIGGERED

  → price hits midpoint (6597)
  → fillEntry(entry2)       avg entry recalculated, stop recalculated, timer reset
  → notifier fires ENTRY_TRIGGERED

  → price hits SELL OUTER/max_sell_1 (6616)
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

## Docker distribution

The app is distributed as a pre-built image on GitHub Container Registry:

- **Image:** `ghcr.io/walshe/trident:latest`
- **Built by:** `.github/workflows/docker-publish.yml` — triggers automatically on pushes to `main` that touch `src/`, `Dockerfile`, `package*.json`, or `tsconfig.json`
- **Two compose files:**
  - `docker-compose.yml` — uses the registry image (FB's file)
  - `docker-compose.override.yml` — adds `build: .` on top (dev only, auto-merged by Compose)

**Bind mounts** — all data directories are mounted from the host so they survive container restarts and image updates:

| Host path | Container path | Notes |
|---|---|---|
| `./config.yaml` | `/app/config.yaml` | Read-only |
| `./.env` | `/app/.env` | Writable — cTrader token refresh updates this |
| `./setups/` | `/app/setups/` | Setup YAMLs from dashboard |
| `./logs/` | `/app/logs/` | Winston log + engine snapshot |
| `./screenshots/` | `/app/screenshots/` | Chart images from Import flow |

**Static assets gotcha:** `src/web/public/` (HTML/CSS/JS) is not compiled by `tsc` — it must be explicitly copied in the Dockerfile runner stage (`COPY --from=builder /build/src/web/public ./src/web/public`). The web server resolves `publicDir` as `src/web/public` relative to CWD (`/app`).

---

## Key design decisions worth remembering

- **The engine never imports a concrete feed or notifier.** Only interfaces. Swap
  implementations in `index.ts` without touching strategy logic.
- **The validator is the only trust boundary.** Once a setup passes validation,
  the engine treats all values as correct.
- **Calculator functions are pure.** All the maths is side-effect free and tested
  independently of the engine.
- **One engine instance per day.** `engine.reset()` clears the daily lock,
  position, loaded setup, and snapshot file — fresh start. Normally not called
  manually; the snapshot's date stamp causes `loadSnapshot` to reject and
  unlink anything from a prior day.
- **The notifier and the logger serve different audiences.** Notifier = trader
  (what happened). Logger = developer/operator (why it happened).
- **The dashboard is a thin window over the engine.** No business logic in the
  browser. The only state the client owns is the live event log and form
  inputs; everything else (status band, currently loaded setup, position) is
  reconstituted from the WebSocket bootstrap envelope on every connect.
- **AI is optional and never authoritative.** The setup extractor pre-fills
  the form; the analyst always reviews; the validator gates entry into the
  engine. Removing `OPENAI_API_KEY` reverts the dashboard to manual entry —
  nothing else changes.
- **Observability is optional and lives entirely in `index.ts`.**
  `src/observability/` defines the `MetricsBackend` interface, `NoopBackend`
  (the default), `PrometheusBackend` (`prom-client` + `/metrics` endpoint),
  and `OtelBackend` (OTLP gRPC export). The engine and feed classes import
  none of these — instrumentation hooks are wired in `index.ts` only.
  Activated via `--observability=prometheus|otel` CLI flag or
  `TRIDENT_OBSERVABILITY` env var (Docker-friendly alias).

  `MetricsNotifier` is a `Notifier` implementation that translates
  `NotificationEvent` types into `MetricsBackend` calls and sits on the
  `MultiNotifier` children list alongside `ConsoleNotifier`. This is the
  preferred pattern for coarse engine-level metrics (state transitions, entries,
  closes). Fine-grained feed metrics (tick count, tick rate, connection state)
  are recorded directly in `index.ts` at the feed callback boundary — they
  happen at much higher frequency and don't belong in the notifier chain.
