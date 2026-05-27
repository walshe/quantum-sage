# Trident — Phase 1 Analyst Guide

This guide is for the analyst (FB) running the Trident Phase 1 engine
day-to-day. No coding knowledge assumed — just the ability to follow a few
terminal commands and edit a text file.

If you've never run anything from a terminal before, the **Setup** section
below walks through everything from zero.

---

## What Phase 1 actually does

**The engine is an advisor, not an auto-trader.** It:

1. Reads the daily setup YAML you drop into `setups/`.
2. Watches live US500 prices from the cTrader demo feed.
3. Prints a message to the console whenever the Trident strategy would act —
   trade plan ready, entry triggered, breakeven reached, exit hit, etc.

**You place the actual orders manually at the relevant broker.** Nothing in
Phase 1 touches your broker — the cTrader link is read-only (prices only).
This means running the engine carries zero execution risk: if the engine
misbehaves, the worst it can do is print a wrong notification.

Why this matters for Phase 1 testing: you can leave the engine running
against the demo feed all day, drop setup files at it, and watch how it
reacts, without any money or positions being affected.

---

## What your trading day looks like

1. **Morning, before the session:** prepare today's setup (levels, VWAP,
   DVS, bias) using the dashboard and submit it, or drop a YAML directly
   into the `setups/` folder. Filename pattern: `qs_setup_YYYY-MM-DD_HHMM.yaml`.
2. **Start the engine** (see *Daily running instructions* below). A single
   command in the terminal.
3. **Watch the console.** When the engine has something to say, it prints a
   timestamped message. Most of the day it will be silent — that's normal.
4. **Act on the notifications.** When you see `[ENTRY 1]`, place the order
   at the relevant broker. When you see `[CLOSED]`, exit your broker
   position.
5. **Mid-session updates:** if your mid-afternoon levels differ from your
   morning setup, click **Update during session** on the dashboard and
   submit revised values. The engine re-loads automatically. `update_seq`
   is not checked by the engine — bump it for your own audit trail, but
   the file reloads either way. One caveat: if a trade is already open,
   mid-session level changes are ignored so the engine doesn't move the
   goalposts on an in-flight trade.
6. **End of day:** stop the engine (`Ctrl+C` in the terminal).

---

## What the notifications look like

This is real output from a test run on 2026-04-21 against the live cTrader
demo feed. Each block is one console event.

```
[15:34:01] [SIGNAL]   Loaded setups/qs_setup_2026-04-21_1533.yaml
             Date: 2026-04-21 | DVS: 50 (normal) | VWAP: 7140
```

Your setup was accepted. If validation had failed you'd see
`[SIGNAL INVALID]` with a list of problems instead.

```
[15:34:01] [SETUP]    SHORT trade ready
             Entry 1: 7163.00 (32.5%)
             Entry 2: 7164.50 (35%)
             Entry 3: 7170.00 (32.5%)
             Stop: 40pts from avg entry | Target: VWAP @ 7140.00
```

DVS gate passed, trade plan laid out. This is the strategy's summary of what
it intends to do today. The engine now watches price silently until
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
| `[SIGNAL]` | — | Setup accepted and loaded. |
| `[SIGNAL INVALID]` | — | Setup failed validation. The error list tells you which rule broke. |
| `[SIGNAL WARNING]` | — | Setup loaded with warnings (e.g. stale VWAP). Still trading. |
| `[DVS GATE]` | — | DVS > 75. **No trades today.** Engine stays idle. |
| `[SETUP]` | — | Trade plan ready. Waiting for Entry 1. |
| `[NO SETUP]` | — | Bias + your levels don't give a valid trade (e.g. bias=long but no BUY INNER+OUTER pair). Submission validation usually catches this first; you'd only see it from a hand-edited YAML or a bias/levels mismatch. |
| `[ENTRY 1]` | **Yes** | Open the position at the relevant broker at the stated size and stop. |
| `[ENTRY 2/3]` | **Yes** | Scale in at the relevant broker and update your stop to the new avg-entry-based level. |
| `[BREAKEVEN]` | **Yes** | Move your broker stop to the stated level; cancel any unfilled entry orders. |
| `[CLOSED]` | **Yes** | Exit at the relevant broker. The reason (`vwap_hit`, `stop_loss`, `time_exit`, `invalidation`, `expiry`, `hard_profit_exit`) is printed. |
| `[LOCK]` | — | One winning trade done — no more trades today, even if another setup appears. |

### The "quiet day" case

On most days you'll see `[SIGNAL]` and `[SETUP]` in the morning, and then
nothing until either Entry 1 triggers or the expiry time is reached.
Silence is not a problem — it just means price hasn't reached your setup levels.

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

Ask Emmett for the cTrader values — they go in a file called `.env` in
this folder. He can send you a starter `.env` file directly; drop it into
`trident/impl/nodejs/` and you're done.

If you need to run the OAuth flow yourself:

```bash
npm run auth:ctrader
```

Follow the prompts — it opens a browser, you log into cTrader, and the
command writes the tokens into `.env` automatically. The engine refreshes
the access token in the background as it expires and writes the new value
back into `.env`, so you should rarely need to re-run this.

### 5b. (Optional) AI screenshot extraction

The dashboard has an **Import from screenshot** button that can read your
IV Smile chart and pre-fill the form. To enable it, add
this line to `.env`:

```
OPENAI_API_KEY=sk-...
```

Without a key, the Import button still uploads and stores the images on
the server, but the form is not auto-filled and a banner says "AI
extraction unavailable" — you fill the form manually.

### 6. Verify everything works

```bash
npx tsx src/index.ts --mock
```

This runs a scripted demo scenario (no live feed, no real setup file).
You should see a short sequence of notifications play out in the console —
setup loaded, trade plan, entries, close. If that scrolls cleanly, installation is
done.

---

## Daily running instructions

Every day, from the `trident/impl/nodejs/` folder in Terminal:

### 1. Start the engine

```bash
npx tsx src/index.ts
```

You should see:

```
Trident qs-signal-engine starting...
Config: /.../config.yaml
Watching for setups in: /.../setups
Trident UI: http://localhost:3000
Connecting to cTrader (symbol: US500)...
cTrader price feed connected.
```

The engine is now live.

### 2. Open the dashboard

Open **http://localhost:3000** in your browser. The page has a **status
band** at the top and a **Live log** below it. You open the setup form
in a modal by clicking one of the top buttons:

- **New setup** — clears the form and resets `update_seq` to 1 for the
  morning setup.
- **Update during session** — keeps the current values but bumps
  `update_seq` for an intra-day recalibration.
- **Pre-fill from latest** — loads today's most recent setup file into
  the form so you can tweak only what's changed.
- **Import from screenshot** *(AI)* — upload one IV Smile chart screenshot.
  If `OPENAI_API_KEY` is set, Trident reads the chart's range panel
  (Range 1/2 up/down) to extract BUY INNER/OUTER, SELL INNER/OUTER levels,
  ranges, DVS, and skew, then pre-fills the form. **Always review every
  value** before submitting — extraction is best-effort, not authoritative.
  VWAP, cash last, basis, and invalidation fields are never extracted and
  must be filled in manually.
- **Status** — opens a read-only view of the engine right now (state,
  connection, daily lock, currently loaded setup, any open position).

In the form modal, click **Submit setup** when done. A brief
"Submitted … waiting for engine" appears, then it clears to "Loaded …"
when the engine picks the file up — typically within a second.

The **Live log** mirrors what would appear in the terminal: `[SIGNAL]`,
`[SETUP]`, `[ENTRY 1]`, `[BREAKEVEN]`, `[CLOSED WIN]`, `[LOCK]`. Action
rows are highlighted in orange with a `>>> ACTION:` line — those are the
ones you act on at the broker.

The status band shows, at a glance: "Connected / Reconnecting /
Disconnected", current state (`idle / watching / in_trade / closed /
locked`), latest price, and the currently loaded setup.

**Bias field.** In the form's **Bias** section, the Direction dropdown sets
your directional overlay for the trade:

| Value | Behaviour |
|-------|-----------|
| `neutral` *(default)* | Engine watches **both** long and short Entry 1 prices at the same time. Whichever side is hit first becomes the trade; the other is cancelled immediately. Both BUY INNER+OUTER and SELL INNER+OUTER must be filled in for true two-sided watching. |
| `long` | Engine only watches the long side (BUY INNER+OUTER required). |
| `short` | Engine only watches the short side (SELL INNER+OUTER required). |

If you don't have a view, leave it on `neutral` — the engine will trade
whichever direction the market moves to first.

**VWAP Calculate button.** In the form, the VWAP Value field has a
**Calculate** button to its right. Clicking it fetches today's M1 bars
directly from the cTrader connection and computes VWAP = Σ((H+L+C)/3 × V) / ΣV,
then populates the field and stamps "Updated at" to the current time. The button
spins (shows "…") while fetching and re-enables when done. If the cTrader feed
is not connected (or you're using a mock/demo setup), the button shows an error
— in that case, enter VWAP manually from Bookmap or your charting tool as usual.

**During the day — recalibrating.** Around midday, click **Update during
session**. This bumps `update_seq` and puts today's time on the
submission so the engine recognises it as a recalibration, not a new
day's setup. Update VWAP and any level fields that changed, then submit.
The Calculate button works for recalibrations too — click it to refresh
VWAP to the current intraday value.

> **Important:** the engine ignores any submission (New setup or Update
> during session) while a trade is open. The running trade always uses
> the levels it started with. Recalibrate only after the trade closes.

**Inline validation feedback.** If the server rejects a submission, the
banner lists every error and the offending fields are outlined in red
with the message printed under each input. The page scrolls to the first
problem field for you.

### 3. Watch and act

Keep the dashboard visible. Place and manage orders at the broker
manually based on what you see. Every row with a `>>> ACTION:` line is
something for you to do now.

If you close the browser mid-trade, nothing happens to the engine —
re-open the tab and the state band repopulates from the bootstrap
snapshot. The terminal still has the full log too.

### Manual YAML fallback

If the dashboard is unavailable (e.g. you're on a different machine via
SSH), you can still create today's setup by hand:

```bash
cp setups/qs_setup_<yesterday>_<time>.yaml setups/qs_setup_$(date +%Y-%m-%d)_0900.yaml
```

Edit the copy in any editor and update `meta.date`, `meta.timestamp`,
`volatility.*`, `vwap.*`, `ranges.*`, `levels.*`, `bias.*`, and
`invalidation.*`. The engine picks up the file on save.

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

The engine rejected the setup. Common issues:

- **"Required levels are missing — provide BUY INNER+OUTER or SELL INNER+OUTER"**
  — at least one full pair is needed; otherwise the engine has no entries
  to compute.
- **"Sell level ordering invalid"** — SELL INNER (`max_sell_2`) must be
  *lower than* SELL OUTER (`max_sell_1`).
- **"Basis math mismatch"** — `futures_last − cash_last` must equal `basis`
  within ±5. Quick fix: set `basis = futures_last − cash_last` (e.g.
  futures 7409, cash 7360 → basis 49). If you don't have a reliable SPX
  cash price, enter consistent made-up values or ask Emmett to remove the
  `required` constraint from those fields.
- **"Invalidation boundaries must bracket futures_last"** —
  `void_below < futures_last < void_above`. Common cause: a void value
  is in SPX cash terms instead of ES futures terms.
- **"too old to trade"** — the setup file's `date`/`timestamp` is more
  than 6 hours in the past. Update and save again.

If you submitted via the dashboard, the relevant input fields are also
red-highlighted with the error text under them. Fix and resubmit. If you
edited the YAML directly, the engine will re-read on save.

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
| `setups/qs_setup_*.yaml` | Your daily setup files. The engine watches this folder. |
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
