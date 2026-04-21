# Trident — Phase 1 Analyst Guide

This guide is for the analyst (FB) running the Trident Phase 1 engine
day-to-day. No coding knowledge assumed — just the ability to follow a few
terminal commands and edit a text file.

If you've never run anything from a terminal before, the **Setup** section
below walks through everything from zero.

---

## What Phase 1 actually does

**The engine is an advisor, not an auto-trader.** It:

1. Reads the daily YAML signal file you drop into `signals/`.
2. Watches live US500 prices from the cTrader demo feed.
3. Prints a message to the console whenever the Trident strategy would act —
   setup ready, entry triggered, breakeven reached, exit hit, etc.

**You place the actual orders manually at the relevant broker.** Nothing in
Phase 1 touches your broker — the cTrader link is read-only (prices only).
This means running the engine carries zero execution risk: if the engine
misbehaves, the worst it can do is print a wrong notification.

Why this matters for Phase 1 testing: you can leave the engine running
against the demo feed all day, drop signal files at it, and watch how it
reacts, without any money or positions being affected.

---

## What your trading day looks like

1. **Morning, before the session:** update your signal YAML for today
   (levels, VWAP, DVS, bias) and save it into the `signals/` folder.
   Filename pattern: `qs_signal_YYYY-MM-DD_HHMM.yaml`.
2. **Start the engine** (see *Daily running instructions* below). A single
   command in the terminal.
3. **Watch the console.** When the engine has something to say, it prints a
   timestamped message. Most of the day it will be silent — that's normal.
4. **Act on the notifications.** When you see `[ENTRY 1]`, place the order
   at the relevant broker. When you see `[CLOSED]`, exit your broker
   position.
5. **Mid-session updates:** if your mid-afternoon levels differ from your
   morning levels, edit the YAML (or drop a new one) and save. The engine
   re-loads automatically. `update_seq` is not checked by the engine —
   bump it for your own audit trail, but the file reloads either way. One
   caveat: if a trade is already open, mid-session level changes are
   ignored so the engine doesn't move the goalposts on an in-flight trade.
6. **End of day:** stop the engine (`Ctrl+C` in the terminal).

---

## What the notifications look like

This is real output from a test run on 2026-04-21 against the live cTrader
demo feed. Each block is one console event.

```
[15:34:01] [SIGNAL]   Loaded signals/qs_signal_2026-04-21_1533.yaml
             Date: 2026-04-21 | DVS: 50 (normal) | VWAP: 7140
```

Your YAML was parsed and accepted. If validation had failed you'd see
`[SIGNAL INVALID]` with a list of problems instead.

```
[15:34:01] [SETUP]    SHORT trade ready
             Entry 1: 7163.00 (32.5%)
             Entry 2: 7164.50 (35%)
             Entry 3: 7170.00 (32.5%)
             Stop: 40pts from avg entry | Target: VWAP @ 7140.00
```

DVS gate passed, trade plan laid out. This is your "here's what the strategy
intends to do today" summary. The engine now watches price silently until
Entry 1 triggers.

```
[15:41:00] [ENTRY 1]   SHORT @ 7160.10 (32.5%)
             Avg entry: 7160.10 | Stop: 7200.10 | Fills remaining: 2
             >>> ACTION: Open SHORT at broker (32.5% size). Set stop @ 7200.10.
```

Live price crossed Entry 1. The `>>> ACTION:` line tells you exactly what
to do at the relevant broker. Any notification with a `>>> ACTION:` line is
something you need to *do* right now; everything else is informational.

```
[15:41:38] [ENTRY 2]   SHORT @ 7162.10 (35%)
             Avg entry: 7161.14 | Stop: 7201.14 | Fills remaining: 1
             >>> ACTION: Scale into SHORT at broker (35% size). Set stop @ 7201.14.
```

Price touched Entry 2 — scale in at the relevant broker and update your
stop to the new level. Avg entry and stop have been recalculated for you.

### Other notifications you'll see over time

Notifications marked **Action** carry a `>>> ACTION:` line and require you
to do something at the broker. The rest are informational — nothing for
you to do.

| Tag | Action? | Meaning |
|---|---|---|
| `[SIGNAL]` | — | YAML parsed and accepted. |
| `[SIGNAL INVALID]` | — | YAML failed validation. The error list tells you which rule broke. |
| `[SIGNAL WARNING]` | — | Loaded but with warnings (e.g. stale VWAP). Still trading. |
| `[DVS GATE]` | — | DVS > 75. **No trades today.** Engine stays idle. |
| `[SETUP]` | — | Trade plan ready. Waiting for Entry 1. |
| `[NO SETUP]` | — | Required levels missing — bias + your levels don't give a valid trade. |
| `[ENTRY 1]` | **Yes** | Open the position at the relevant broker at the stated size and stop. |
| `[ENTRY 2/3]` | **Yes** | Scale in at the relevant broker and update your stop to the new avg-entry-based level. |
| `[BREAKEVEN]` | **Yes** | Move your broker stop to the stated level; cancel any unfilled entry orders. |
| `[CLOSED]` | **Yes** | Exit at the relevant broker. The reason (`vwap_hit`, `stop_loss`, `time_exit`, `invalidation`, `expiry`, `hard_profit_exit`) is printed. |
| `[LOCK]` | — | One winning trade done — no more trades today, even if another setup appears. |

### The "quiet day" case

On most days you'll see `[SIGNAL]` and `[SETUP]` in the morning, and then
nothing until either Entry 1 triggers or the expiry time is reached.
Silence is not a problem — it just means price hasn't reached your levels.

---

## Setup (one-time, for non-developers)

Do this once per machine. Takes about 10 minutes.

### 1. Install Node.js (the runtime)

Download the **LTS** version from <https://nodejs.org> and run the installer
with default options. This gives you two commands, `node` and `npm`, that
everything else needs.

After the installer finishes, open a new **Terminal** window (macOS:
`Cmd+Space`, type "Terminal") and verify:

```bash
node --version
```

You should see something like `v20.x.x` or higher. If you see "command not
found", restart the Terminal.

### 2. Get the code

If Emmett sent you a zip: unzip it to a folder you'll remember, e.g.
`~/quantum-sage`.

If you have `git` (the installer puts it on most Macs):
`git clone <repo-url> ~/quantum-sage`.

### 3. Open a terminal in the code folder

In Terminal:

```bash
cd ~/quantum-sage/trident/impl/nodejs
```

(Adjust the path if you unzipped somewhere else.)

### 4. Install dependencies

```bash
npm install
```

This downloads the libraries the engine needs (one-time — takes a minute or
so). You'll see a progress bar and possibly some warnings; those are
normal.

### 5. Set up the cTrader price feed

Ask Emmett for the five cTrader values — they go in a file called `.env` in
this folder. He can send you a starter `.env` file directly; drop it into
`trident/impl/nodejs/` and you're done.

If you need to run the OAuth flow yourself:

```bash
npm run auth:ctrader
```

Follow the prompts — it opens a browser, you log into cTrader, and the
command writes the tokens into `.env` automatically.

### 6. Verify everything works

```bash
npx tsx src/index.ts --mock
```

This runs a scripted demo scenario (no live feed, no real signal file).
You should see a short sequence of notifications play out in the console —
signal loaded, setup, entries, close. If that scrolls cleanly, setup is
done.

---

## Daily running instructions

Every day, from the `trident/impl/nodejs/` folder in Terminal:

### 1. Create today's signal file

Copy yesterday's signal:

```bash
cp signals/qs_signal_<yesterday>_<time>.yaml signals/qs_signal_$(date +%Y-%m-%d)_0900.yaml
```

Open the new file in any text editor and update:

- `meta.date` and `meta.timestamp`
- `meta.futures_last`, `meta.cash_last`, `meta.basis`
- `volatility.dvs`, `volatility.skew`, `volatility.regime`
- `vwap.value` and `vwap.updated_at`
- `ranges.*` and `levels.*`
- `bias.direction`, `bias.confidence`, `bias.notes`
- `invalidation.void_above`, `void_below`, `expiry`

Save the file. **Don't save it yet into the `signals/` folder if the engine
isn't running** — if it's running and you save an incomplete file, it'll
reject it with `[SIGNAL INVALID]`. Edit elsewhere, then save into
`signals/` when ready.

### 2. Start the engine

```bash
npx tsx src/index.ts
```

You should see:

```
Trident qs-signal-engine starting...
Config: /.../config.yaml
Watching for signals in: /.../signals
Connecting to cTrader (symbol: US500)...
cTrader price feed connected.
```

The engine is now live. If your signal is already in the folder with
today's date, drop it in (or touch it) to load it now:

```bash
touch signals/qs_signal_2026-04-21_0900.yaml
```

(That "touches" the file — updates its timestamp without changing content —
which makes the engine re-read it.)

### 3. Watch and act

Keep the Terminal window visible. Notifications are timestamped and
self-explanatory. Place and manage orders at the relevant broker manually
based on what you see.

### 4. Stop the engine

When you're done for the day, click in the Terminal window and press
`Ctrl+C` (actual `Control`+`C`, not Cmd+C). You'll see:

```
Shutting down...
```

That's it.

---

## Troubleshooting

### "command not found: node" or "npm"

Node.js isn't installed (or the Terminal needs restarting after installing
it). Go back to Setup step 1.

### "[SIGNAL INVALID]" with a list of errors

The engine printed what's wrong. Common issues:

- **"Sell level ordering invalid"** — remember `max_sell_2` (inner) must be
  *lower than* `max_sell_1` (outer).
- **"Range ordering invalid"** —
  `range_1_down < range_2_down < range_2_up < range_1_up`.
- **"Basis math mismatch"** — `futures_last - cash_last` must be within ±5
  of `basis`.
- **"too old to trade"** — the signal file's `date`/`timestamp` is more
  than 6 hours in the past. Update and save again.

Fix the YAML and save; the engine will re-read automatically.

### "cTrader connection failed"

The access token may have expired, or the internet is flaky. The engine
retries every 5 seconds automatically. If it keeps failing after a minute
or two, ask Emmett — the token may need re-issuing with
`npm run auth:ctrader`.

### Engine crashed / I closed the Terminal mid-trade

Just start it again with `npx tsx src/index.ts`. It restores the last-known
state from `logs/engine-state.json` — your position, avg entry, current
stop, everything — and resumes notifications. State from a previous
trading day is discarded automatically.

### The price seems stuck / no notifications

Check that you still see "Connecting to cTrader..." followed by "price feed
connected" in the startup messages. If not, the feed isn't actually
streaming. With `LOG_LEVEL=debug npx tsx src/index.ts` you can see every
tick in the console (noisy, but useful to confirm data is flowing).

### I accidentally ran two copies

Stop them both with `Ctrl+C` and start only one. Running two at once
causes problems with the cTrader token and gives you duplicate
notifications. See [FAQ.md](./FAQ.md) for the gory detail. **One engine
per broker account at a time.**

---

## Files you'll touch

| Path | What it is |
|---|---|
| `signals/qs_signal_*.yaml` | Your daily signal files. The engine watches this folder. |
| `config.yaml` | Strategy parameters (DVS gate, stop distance, etc.). Rarely changes. |
| `.env` | cTrader credentials. Do not share this file. |
| `logs/trident.log` | Full audit log (JSON). Useful if something goes wrong — send it to Emmett. |
| `logs/engine-state.json` | Crash-recovery snapshot. Auto-managed; don't edit. |

---

## If something's really wrong

1. `Ctrl+C` to stop the engine.
2. Copy `logs/trident.log` and send it to Emmett along with a description
   of what you were doing.
3. Start fresh: `npx tsx src/index.ts`.

The engine is designed to fail safe — if it can't do something
confidently, it does nothing rather than guess. The worst case in Phase 1
is a missed notification, not a rogue trade.
