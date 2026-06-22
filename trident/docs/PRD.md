![Trident Logo](../trident.png)

# Trident -- Product Requirements Document

> **Status:** DRAFT v1.1
> **Last updated:** April 7, 2026
> **Authors:** Filippo Baldan / Emmett Walsh
> **Stage:** Early design -- many decisions are
> provisional and subject to change.
> **Source docs:** analyst's signal service
> screenshots, DVS documentation, and "Three Level
> VWAP Reversion System Rules" first draft spec
> (02/04/2026).
>
> **v1.1 changes:** Restructured to position Quantum
> Sage as a strategy-agnostic umbrella with Trident
> as the first strategy. Incorporated FB's answers
> from PR comments (marked with **[FB resolved]**).

---

## Table of Contents

1. Overview
2. Background and Context
3. System Concept
4. Roles and Responsibilities
5. The Setup File (Data Contract)
6. Key Data Points and Their Meaning
7. Trident: Trading Logic
8. Risk and Capital Management
9. Instruments and Execution
10. Open Questions and TODOs
11. Architecture Considerations (Preliminary)
12. Glossary
13. Appendices

---

## 1. Overview

**Quantum Sage (QS)** is an umbrella system for
trading strategies that process discretionary
analysis from a human analyst (or, in the future,
an automated pipeline) and generate tradeable
signals.

**_Trident_** is the first strategy implemented under
the Quantum Sage umbrella. It is an intraday
**mean-reversion strategy** for S&P 500 instruments
(ES futures, CFDs, or options), built around
predefined buy and sell levels with VWAP as the
primary take-profit target. Trident builds positions
through a three-entry scaling-in structure with
tightly controlled downside risk.

Future strategies under the QS umbrella may use
different logic, instruments, or timeframes, but
they will all share the same core architecture:
setup file ingestion, strategy logic, tradeable
signal generation, and execution dispatch.

QS is composed of two modules:

- **qs-signal-engine** -- the brain. Ingests the
  analyst's setup file, watches live price, applies
  strategy-specific trading logic (Trident in
  Phase 1), and generates tradeable signals. This
  is the Phase 1 priority.
- **qs-trader** -- the hands. Takes tradeable signals
  from qs-signal-engine and executes them. Initially
  this means displaying signals for a human to act
  on manually. Later, it connects to a broker API or
  trading platform for automated execution. This is
  a Phase 2 addition.

Both modules live under the QS umbrella. They
communicate through a well-defined internal interface
(the tradeable signal), so qs-signal-engine can be
built and validated independently before qs-trader
is wired up.

QS is NOT a fully autonomous system. In its initial
phase, it depends on human-generated setups and
operates within strict boundaries defined by the
analyst.

### 1.1 Core Principle

> Capital protection comes first. Entry logic
> matters, but survival logic matters more.

### 1.2 Long-Term Vision

The current architecture has a human analyst
producing the setup file -- via the dashboard
form, or by importing screenshots that the AI
vision model reads and pre-fills -- and a human
trader executing the resulting signals manually.

**Phase 2** adds automated execution -- qs-trader
sends orders directly to the broker via API (e.g.
cTrader Open API), so the human trader is no
longer needed in the loop. The system remains a
standalone Node.js process; there is no native
platform plugin.

**Phase 3** goes further by automating the analyst's
role as well -- replacing the manual chart reading
and level extraction with an automated pipeline
that ingests raw options data, computes the IV
smile, derives DVS/ranges/levels, and generates the
setup file programmatically.

This is why the setup file (data contract) is
designed as a clean interface between the two halves
of the system. When the analyst side is eventually
automated, QS core logic does not need to change --
it still consumes the same YAML schema regardless
of whether a human or a machine produced it.

**Phase 1 (current):**
  Human analyst --> Setup file --> qs-signal-engine
  --> qs-trader (manual mode) --> Human executes

**Phase 2 (future):**
  Human analyst --> Setup file --> qs-signal-engine
  --> qs-trader (auto mode, broker API)
  --> Broker

**Phase 3 (future):**
  Automated analysis --> Setup file -->
  qs-signal-engine --> qs-trader (auto mode) -->
  Broker

---

## 2. Background and Context

### 2.1 The Analyst's System

The analyst uses a proprietary signal service that
derives trading levels from SPX options market data.
The core inputs are:

- **Implied Volatility Smile** -- the distribution
  of implied volatility across SPX option strikes,
  updated intraday
- **Options positioning** -- where large
  institutional participants have clustered their
  bets (calls, puts, open interest)
- **VWAP** -- used to confirm whether the market is
  building positions in a specific direction

From this data, the signal service produces:

- Expected price ranges for the session (Range 1
  and Range 2 boundaries)
- Key support/resistance levels derived from
  options flow (SELL OUTER/INNER, BUY INNER/OUTER,
  SUPPORTO, RESISTENZA)
- A Directional Volatility Score (DVS) that
  characterizes the expected volatility regime
- SKEW index readings for tail risk assessment

The analyst reviews these outputs, applies
discretionary judgment, and submits the setup to
QS -- either by filling the dashboard form
directly, or by importing chart screenshots that
the AI vision model reads and pre-fills for
review before submission.

### 2.2 Origin of Levels

All levels originate from the signal service's
analysis of SPX options data. The service calculates
levels at two key times:

- **Europe morning** -- initial levels based on
  overnight/morning data
- **Europe mid-afternoon** -- recalibrated levels
  at the US market open (Opening Bell)

Levels from the signal service may be expressed in
either futures or cash (SPX) terms depending on the
chart. When in SPX terms, a daily basis (cost of
carry spread) must be applied to convert to futures
prices. This basis changes daily due to dividends
and interest rates. Recent observed range:
approximately 40-75 points.

### 2.3 The "Coast to Coast" Concept

Trident's primary trade concept is "coast to
coast" -- entering near a MAX BUY zone and riding
the move up to VWAP (for longs), or entering near
MAX SELL and riding down to VWAP (for shorts). The
levels define the battlefield; the trade is about
capturing the mean-reversion move back toward VWAP.

---

## 3. System Concept

```
┌───────────────────────────┐
│   ANALYST (Phase 1)       │
│   or                      │
│   AUTOMATED PIPELINE      │
│   (Phase 3 -- future)     │
│                           │
│   Reviews/computes levels │
│   Updates VWAP            │
│   Fills setup file       │
└─────────────┬─────────────┘
              │
              │  Setup YAML file
              │  (the data contract)
              ▼
┌─────────────────────────────────┐
│         QUANTUM SAGE            │
│         (umbrella)              │
│                                 │
│  ┌───────────────────────────┐  │
│  │   qs-signal-engine        │  │
│  │   Validates setup         │  │
│  │   Watches live price      │  │
│  │   Applies strategy logic  │  │
│  │     (Trident in Phase 1)  │  │
│  │   Generates tradeable     │  │
│  │     signals               │  │
│  └─────────────┬─────────────┘  │
│                │                │
│                │ Tradeable      │
│                │ signal         │
│                │ (internal      │
│                │  interface)    │
│                ▼                │
│  ┌───────────────────────────┐  │
│  │   qs-trader               │  │
│  │                           │  │
│  │   Phase 1: display signal │  │
│  │     for manual execution  │  │
│  │     (Telegram, dashboard) │  │
│  │                           │  │
│  │   Phase 2: auto via       │  │
│  │     broker API            │  │
│  │     (e.g. cTrader)        │  │
│  └─────────────┬─────────────┘  │
│                │                │
└────────────────┼────────────────┘
                 │
                 ▼
┌───────────────────────────┐
│   BROKER / EXCHANGE        │
│   ES futures, CFDs,        │
│   or options               │
└───────────────────────────┘
```

Key design principles:

- **QS is one umbrella, multiple strategies.**
  Trident is the first strategy. Both
  qs-signal-engine and qs-trader live under the
  Quantum Sage umbrella as separate modules, not
  separate projects.
- **Clean separation of concerns.** The analyst (or
  future automated pipeline) owns the "what"
  (levels, bias, regime). qs-signal-engine owns the
  "when" (applying strategy logic to determine
  trade opportunities). qs-trader owns the "how"
  (getting orders to market).
- **Internal interface between modules.** The
  setup is a well-defined data structure passed from
  qs-signal-engine to qs-trader. This allows each
  module to be developed and tested independently.
- **The setup file is a stable external interface.**
  Whether a human or a machine produces it, QS
  consumes the same schema.
- **QS is useful from day one.** qs-signal-engine
  can run standalone, outputting signals to a human
  via qs-trader in manual mode. Automated execution
  is added later without changing qs-signal-engine.

---

## 4. Roles and Responsibilities

### 4.1 The Analyst (Phase 1 -- Human, FB)

- Reviews IV smile charts, options positioning, and
  intraday execution charts
- Determines the day's volatility regime
- Identifies key levels (MAX SELL 1/2, MAX BUY 1/2,
  SUPPORTO, RESISTENZA)
- Updates VWAP periodically (roughly once per hour)
- Submits the day's setup via the dashboard form
  (directly, or via AI screenshot import which
  pre-fills the form for review)
- May issue updated setups intraday (e.g. after
  the Europe mid-afternoon recalibration)
- Sets invalidation boundaries and event risk notes

> **Phase 3 note:** In the future, this role will be
> replaced by an automated pipeline. The setup file
> schema remains the same -- only the producer
> changes.

### 4.2 qs-signal-engine (Phase 1 Priority)

The brain of QS. Responsible for all strategy logic
and signal generation. In Phase 1, this means
implementing the Trident strategy.

- Validates the setup file against the schema
- Loads levels, VWAP, and bias into memory
- Checks DVS gate (if DVS > 75, no trades allowed)
- Monitors live price feed
- Detects when price reaches entry trigger levels
- Generates tradeable signals with:
  - Direction (long or short)
  - Three entry prices and allocation splits
  - Stop loss price (40 points from avg entry)
  - Primary target (VWAP)
  - Hard profit exit (+33 points)
  - Breakeven trigger (+25 points)
  - Time-based exit (180 minutes from last fill)
  - Reasoning (why this trade was generated)
- Tracks active signals and updates them (breakeven
  moves, time exits, invalidations)
- Enforces one-winning-trade-per-day rule
- Logs every decision for auditability
- Passes tradeable signals to qs-trader via internal
  interface

### 4.3 qs-trader (Phase 1 Manual, Phase 2 Auto)

The hands of QS. Responsible for getting signals
in front of a human or into a trading platform.

**Phase 1 (manual mode):**
- Receives tradeable signals from qs-signal-engine
- Displays them for human consumption (Telegram
  alert, dashboard, console output, etc.)
- Receives signal updates (breakeven triggered,
  time exit, invalidation) and displays those too
- Human trader decides whether to act

**Phase 2 (automated mode — implemented):**
- `CTraderOrderExecutor` implements the `Notifier` interface and sits on the
  `MultiNotifier` chain alongside the console and WebSocket notifiers
- Enabled via `config.execution.auto_execute: true`; defaults to `false` (advisory)
- Requires `config.execution.point_value_eur` (EUR per index point per lot) and
  `CTRADER_SYMBOL_ID` env var
- On `ENTRY_TRIGGERED`: places a MARKET order at the broker for the computed lot count
- On `BREAKEVEN_TRIGGERED` / subsequent fills: amends the position stop-loss via
  `ProtoOAAmendPositionSLTPReq`
- On `POSITION_CLOSED`: sends `ProtoOAClosePositionReq` for the full position volume
- On broker rejection: emits `ORDER_FAILED` event (visible in live log); no state rollback
- Uses a dedicated `CTraderSession` (C3 — fault-isolated from price feed and balance poller)
- Volume formula: `floor((capital × riskPct/100 × allocPct/100) / (stopPoints × pointValue))`

### 4.4 Engineer/Developer (EW)

- Builds and maintains QS
- Defines and tunes strategy logic parameters
- Integrates with price feed for live data
- Monitors system health and performance
- Iterates based on backtesting and live results

---

## 5. The Setup File (Data Contract)

### 5.1 Format

- **Format:** YAML
- **Encoding:** UTF-8
- **Schema version:** 1.0
- **Naming:** `qs_setup_YYYY-MM-DD_HHmm.yaml`
  - Date format is ISO 8601: **year-month-day** (e.g. `2026-04-17`, not `17-04-2026`)
  - Time is 24-hour HHmm (e.g. `1006` = 10:06 am)
- **Delivery:** TBD

### 5.2 Why YAML over Excel

- Plain text -- no hidden formatting, no formula
  dependencies, no binary corruption
- Human-friendly -- editable in any text editor
- Machine-friendly -- trivially parseable
- Supports inline comments for analyst notes
- Version control compatible
- Lightweight (~1KB vs ~50KB+ for Excel)
- No dependencies -- QS doesn't need Excel libraries

### 5.3 Schema (v1.0)

The full annotated example is in
`qs_setup_2026-04-02_1006.yaml`.

Summary of sections:

| Section      | Purpose                         |
|--------------|---------------------------------|
| meta         | Date, time, contract, prices,   |
|              | basis, execution instrument     |
| volatility   | DVS, SKEW, regime               |
| vwap         | Current VWAP value and          |
|              | update timestamp                |
| ranges       | Range 1/2 boundaries            |
| levels       | MAX SELL/BUY, SUPPORTO,         |
|              | RESISTENZA                      |
| levels_recal | Optional afternoon recalibration|
| bias         | Optional analyst directional    |
|              | overlay                         |
| invalidation | Void prices, expiry, event risk |

> **[FB resolved]** CALL and CASH levels have been
> removed from the schema. FB confirmed these are
> personal tools used by the analyst, derived
> manually, and should NOT be plotted automatically
> or included in the strategy logic.

### 5.4 Validation Rules

- All required fields present
- Range ordering correct
  (range_1_down < range_2_down < range_2_up <
  range_1_up)
- All prices positive and within 20% of futures_last
- Basis math: if `cash_last` and `basis` are both
  present, futures_last - cash_last ≈ basis
  (±5 tolerance). If either is null (e.g. imported
  from screenshots where SPX feed was unavailable),
  skip this check entirely — do not block submission.
- DVS within 0-200 range
- DVS gate: if DVS > 75, QS should flag "no trade
  day" immediately
- VWAP present and reasonable
- Enum fields valid
- Invalidation boundaries sensible
- Setup not stale

---

## 6. Key Data Points and Their Meaning

### 6.1 DVS (Directional Volatility Score)

A measure of expected directional volatility.

| DVS       | Regime     | QS Action              |
|-----------|------------|------------------------|
| Below 50  | Low vol    | Ideal for this system. |
|           |            | Mean-reversion favored.|
| 50 - 75   | Moderate   | System active.         |
|           |            | Normal conditions.     |
| Above 75  | Elevated+  | **NO TRADES ALLOWED.** |
|           |            | DVS gate blocks all    |
|           |            | entries.               |

> **NOTE:** The analyst's system spec explicitly
> states: "If DVS is above 75%, no trades are
> allowed."
> Trident is purely mean-reversion, so high vol
> environments are avoided entirely.

Additional insight: if DVS is compressing through
the session (current < prior), conditions are
improving for this system. If expanding, conditions
are deteriorating.

### 6.2 VWAP

**The primary take-profit target for all Trident
trades.**

VWAP (Volume Weighted Average Price) represents the
average price weighted by volume. In a mean-reversion
system, price is expected to return to VWAP after
deviating to the MAX BUY or MAX SELL zones.

VWAP is entered by the analyst into the dashboard
form (directly, or pre-filled via AI screenshot
import) and updated periodically intraday. Reliable
VWAP requires volume data from a professional
platform like Bookmap or MultiCharts. Since VWAP
does not change dramatically over short periods,
manual updates every few hours are acceptable.

### 6.3 Range Levels

Expected price boundaries from the IV smile.

- **Range 1** (outer) -- 75% historical re-entry
  rate. Price comes back inside 3 out of 4 times.
- **Range 2** (inner) -- tighter zone where price
  spends most of its time.

Low DVS = higher confidence price stays in Range 1.
High DVS = more likely to break out and stay out.

### 6.4 Key Levels (Entry Triggers)

Levels are read from the IV Smile chart's range panel (ES futures terms) and
map to the following display names and schema fields:

| IV chart label | Display name | Schema field   | Role               | Entry     |
|----------------|--------------|----------------|--------------------|-----------|
| Range 1 up     | SELL OUTER   | `max_sell_1`   | Resistance (outer) | Short E3  |
| Range 2 up     | SELL INNER   | `max_sell_2`   | Resistance (inner) | Short E1  |
| Range 2 down   | BUY INNER    | `max_buy_2`    | Support (inner)    | Long E1   |
| Range 1 down   | BUY OUTER    | `max_buy_1`    | Support (outer)    | Long E3   |
| SUPPORTO       | Support      | `supporto`     | Support pivot      | Optional  |
| RESISTENZA     | Resistance   | `resistenza`   | Resistance pivot   | Optional  |

Price ordering invariant (low to high):
`BUY OUTER < BUY INNER < SELL INNER < SELL OUTER`
(`max_buy_1 < max_buy_2 < max_sell_2 < max_sell_1`)

> **[FB resolved 2026-05-12]** Level mapping confirmed with new terminology:
> BUY INNER = Long Entry 1 (inner, first touched)
> BUY OUTER = Long Entry 3 (outer, last touched)
> Long Entry 2 = midpoint of BUY INNER and BUY OUTER
> The same logic applies on the sell side using
> SELL INNER (Short Entry 1) and SELL OUTER (Short Entry 3).
> Previously called MAX BUY 2/1 and MAX SELL 2/1 respectively.

> **[FB resolved]** CALL and CASH have been removed
> from this table. They are personal tools the
> analyst uses on his charts but should not be
> included in Trident's strategy logic. CASH was
> simply the previous day's cash close. CALL/PUT
> were derived manually by the analyst.

Levels are calculated in the European morning and
optionally recalibrated in the European
mid-afternoon.

### 6.5 SKEW Index

Measures tail risk premium. Higher = more downside
protection being bought. Exact QS usage TBD.

### 6.6 Basis (ES-SPX Spread)

`futures_price - basis = cash_price`

Changes daily. Recent range: 40-75 points.

---

## 7. Trident: Trading Logic

> **Source:** Analyst's "Three Level VWAP Reversion
> System Rules" first draft, 02/04/2026, plus FB's
> PR comment answers.

Trident is the first strategy implemented under
the Quantum Sage umbrella. Future strategies may
have different logic, but the architecture (setup
file, qs-signal-engine, qs-trader) remains shared.

### 7.1 System Type

Trident is an **intraday mean-reversion strategy**.

- Trades are built around predefined buy or sell
  levels
- VWAP is the primary take-profit target
- Positions are built through three separate entries
- The strategy does NOT trade breakouts or trends
- If DVS > 75, no trades are taken at all

### 7.2 DVS Gate (Pre-Trade Check)

Before any trade logic runs:

- If DVS > 75 --> **no trades for the day**
- This is a hard gate, not a soft filter
- The strategy is designed for mean-reversion only;
  high-vol environments are skipped entirely

### 7.3 Three-Entry Scaling Structure

The position is built in three entries:

| Entry   | Trigger            | Allocation |
|---------|--------------------|------------|
| Entry 1 | First level        | 32.5%      |
|         | (inner, closest    |            |
|         | to current price)  |            |
| Entry 2 | Midpoint level     | 35.0%      |
|         | (calculated)       |            |
| Entry 3 | Final level        | 32.5%      |
|         | (outer, furthest   |            |
|         | from price)        |            |

**Midpoint calculation:**
- Midpoint = average of Entry 1 and Entry 3
- Buy side: midpoint + 2 points
- Sell side: midpoint - 2 points

> **IMPORTANT:** Only Entry 1 and Entry 3 come from
> the setup file (as BUY/SELL INNER/OUTER levels). Entry 2
> is **calculated by qs-signal-engine** at runtime
> from those two levels. It does not appear in the
> YAML.

> **[FB resolved]** The +2 / -2 midpoint offset is
> intentional. FB confirmed that on the buy side,
> shifting the midpoint by +2 points means
> intentionally accepting a slightly worse entry
> price (closer to Entry 1) rather than capturing
> the full pullback. This trades 2 points of
> potential profit for higher fill probability.
> The same logic applies in mirror on the sell side
> (-2).
>
> This must remain a **configurable parameter** in
> the QS config so it can be adjusted from the
> software without code changes.

**No additional averaging** is allowed beyond the
third entry.

### 7.3.1 Missing Level Behavior

> **[FB resolved]** If the required levels are not
> available in the setup file (e.g. one of the
> BUY OUTER/INNER or SELL OUTER/INNER levels is null),
> qs-signal-engine should **skip the trade
> entirely**. No fallback, no two-entry mode -- the
> safest and most prudent approach is to take no
> signal at all when the full three-level structure
> cannot be built.

### 7.4 Long Entry Example

> **[FB resolved]** Example confirmed by analyst.

Given BUY INNER = 6467 and BUY OUTER = 6440:

- Entry 1: 6467.00 (BUY INNER, 32.5%)
- Midpoint: (6467 + 6440) / 2 + 2 = 6455.50
- Entry 2: 6455.50 (35.0%)
- Entry 3: 6440.00 (BUY OUTER, 32.5%)
- Stop: 40 points below average entry price
- Target: VWAP

### 7.5 Exit Strategy

**Primary take-profit: VWAP**
- The main target for all trades is VWAP
- The full position is closed when VWAP is reached

**Hard profit exit: +33 points**
- If the position reaches +33 points from average
  entry, close immediately
- Even if VWAP has not been reached yet
- This is an **emergency profit cap**, not the
  primary target. In normal operation, VWAP will
  be hit first (step 4 in priority order). The
  +33 exit only fires if VWAP is unusually far
  from entry and price runs hard before reaching
  it.

**Breakeven trigger: +25 points**
- If a single-entry or averaged position goes more
  than +25 points into profit, move the stop loss
  to breakeven (average entry price)

**Stop loss: 40 points**
- Set at 40 points from the average entry price
  of the open position
- This is a hard stop, always enforced

**Time-based exit: 180 minutes**
- If the trade does not reach VWAP or the +33 point
  target within 180 minutes, exit at market

> **[FB resolved]** The 180-minute timer starts
> from the **last entry filled**, not the first.
> The timer **resets each time a new entry is
> executed**. So if Entry 1 fills at 10:00, Entry 2
> at 10:30, and Entry 3 at 11:00, the 180-minute
> clock starts from 11:00 (target exit at 14:00).

> **TODO FB:** Analyst's original spec mentioned a
> possible additional management step around +20
> points profit. FB asked for clarification on this
> in the v1.0 review -- need to revisit. The
> question was whether QS should perform any
> intermediate action (partial exit, stop tighten,
> etc.) when the position reaches +20 points
> profit, before the +25 breakeven trigger fires.

### 7.6 Daily Lock After Winning Trade

- If the strategy closes one profitable trade, **no
  more trades are allowed for the rest of the day**
- This is a hard rule

### 7.7 Overnight Exception

- The strategy may hold a position overnight ONLY
  if the final entry level (Entry 3) is triggered
  during the last trading hour (21:00-22:00)
- In that case, the position must be closed no
  later than 07:00 the following morning

### 7.8 Morning vs Afternoon Levels

> **[FB resolved]** If not triggered, the morning
> levels remain valid until the afternoon levels
> are released. Once afternoon levels are
> published, untriggered morning levels are
> invalidated and replaced.

### 7.9 Directional Bias

The setup file carries an optional `bias.direction` field that guides which
side the engine trades. Default is `neutral`.

| Bias value | Engine behaviour |
|------------|-----------------|
| `neutral`  | Watch both Entry 1 prices simultaneously. Whichever side (long or short) is hit first becomes the trade; the other side is cancelled. Requires both BUY INNER+OUTER **and** SELL INNER+OUTER to be present. If only one pair is present, falls back to that side. |
| `long`     | Only take the long setup (requires BUY INNER+OUTER). |
| `short`    | Only take the short setup (requires SELL INNER+OUTER). |

**Two-sided watching** (neutral bias, both pairs present):
- Engine keeps two entry chains in memory simultaneously.
- On every price tick, both Entry 1 prices are checked.
- The first side to trigger wins; the other is discarded immediately.
- Snapshot persistence includes the alt chain (`tradeSetupAlt`) so
  two-sided watching survives an engine restart.

### 7.10 System Logic Priority

QS should evaluate in this order:

1. Risk limit checks (daily loss, DVS gate)
2. Trade eligibility checks (daily lock, session
   time, setup validity)
3. Entry execution by level (three-entry structure)
4. VWAP and target monitoring
5. Breakeven activation above +25 points
6. Full close at +33 points
7. Time-based exit after 180 minutes (from last
   fill)
8. Daily lock after one winning trade

---

## 8. Risk and Capital Management

> **Source:** Analyst's system spec. These are the
> proposed starting parameters for Trident.

### 8.1 Capital and Daily Risk

| Parameter              | Value             |
|------------------------|-------------------|
| Starting capital       | EUR 80,000        |
| Daily risk %           | 0.5%              |
| Soft daily stop        | EUR 400           |
| Hard daily stop        | EUR 800           |

> **[FB resolved]** FB corrected the hard daily
> stop from EUR 4,000 to **EUR 800** in the v1.0
> review. The earlier figure was a typo in the
> source spec.

- Position size is calculated so that the maximum
  loss at stop loss (40 points) does not exceed the
  daily risk limit (EUR 400)
- The EUR 800 hard limit is an emergency line and
  should NOT be used as the normal operating
  threshold
- If the soft daily stop (EUR 400) is reached,
  trading stops for the day under normal conditions

### 8.1.1 Effective "One Trade Per Day" Implication

> **[FB resolved]** FB confirmed that under the
> current rules, Trident is **effectively a
> one-trade-per-day strategy** in normal conditions,
> and this is acceptable.

The combination of these rules means that under
normal operation, **Trident takes one trade per
day:**

- If the trade wins --> daily lock (Section 7.6)
  prevents further trades
- If the trade loses at the 40-point stop --> the
  loss equals the soft daily stop (EUR 400), so
  trading stops

The EUR 800 hard daily stop is an **emergency
backstop only** -- it would only be reached
through slippage, gap risk, overnight holds gone
wrong, or broker/platform failures. Under normal
logic it is unreachable.

If later we decide that Trident should allow
multiple attempts in the same day, we can revise
the relationship between per-trade risk and the
soft daily stop.

> **NOTE:** These are QS configuration parameters,
> NOT part of the setup file. They live in a
> separate QS config file that rarely changes.

### 8.2 Position Size Adaptation

| Condition                    | Next Day Size  |
|------------------------------|----------------|
| Normal                       | 100%           |
| After 1 losing day           | 50% of normal  |
| After 2 consecutive losing   | 25% of normal  |
| days                         |                |
| After a profitable day       | Recalculate    |
|                              | proportionally |
|                              | to updated     |
|                              | equity balance |

- After a losing day, size is reduced to slow down
  loss escalation and reduce emotional pressure
- After a profitable day, size is recalculated
  based on updated equity -- if equity increased,
  position size increases accordingly

### 8.3 Stop Loss

- 40 points from the average entry price of the
  open position
- This is a hard stop, always enforced
- Position size must be calculated such that a
  40-point stop does not exceed the daily risk
  limit

### 8.4 Profit Protection

- At +25 points profit: move stop to breakeven
  (average entry price)
- At +33 points profit: close entire position
  immediately

### 8.5 Financial Risk Warnings

- QS generates signals that lead to real-money
  trades. Every bug is a potential financial loss.
- Paper trading phase is mandatory before live
  deployment.
- Daily loss limits must be enforced at both the QS
  level AND at the broker level.
- Invalidation logic must be bulletproof.

### 8.6 Technical Risk

- Price feed outage -- QS must detect and halt
- Setup file corruption -- validation catches this
- Clock drift -- timestamps matter for 180-min
  timer and setup expiry
- Network issues -- QS should not assume permanent
  connectivity

### 8.7 Operational Risk

- Stale setups -- must not trade yesterday's levels
- Fat finger in setup file -- validation is safety
  net
- Conflicting update_seq -- always use latest
- Session boundaries must be respected

---

## 9. Instruments and Execution

### 9.1 Supported Instruments

- **ES futures** (E-mini S&P 500) -- native, levels
  in futures terms
- **CFDs** (e.g. US500.cash) -- requires basis
  adjustment
- **SPX options** -- possible but not primary use
  case for Trident

### 9.2 Broker / Execution (qs-trader)

> **Phase 1:** qs-trader operates in manual mode --
> displays events for human execution. No order
> API integration needed.
>
> **Phase 2:** qs-trader is extended to place orders
> via the cTrader Open API (the same WebSocket
> connection already used for the price feed).
> No native platform plugin required -- the system
> stays a standalone Node.js process throughout.

### 9.3 Currency

Starting capital is denominated in EUR. Profit/loss
on ES futures is in USD. Currency conversion
implications TBD.

---

## 10. Open Questions and TODOs

### Resolved in v1.1 (from FB's PR review)

The following items have been resolved by FB and
no longer need action:

- ✅ **VWAP source** -- FB will manually update VWAP
  in an external file. Engineer may also retrieve
  externally if possible. (Section 6.2)
- ✅ **Level mapping (BUY INNER / BUY OUTER)** -- confirmed:
  BUY INNER (`max_buy_2`) = Long Entry 1, BUY OUTER (`max_buy_1`) = Long
  Entry 3. SELL INNER (`max_sell_2`) = Short Entry 1, SELL OUTER
  (`max_sell_1`) = Short Entry 3. (Section 6.4)
- ✅ **CALL and CASH levels** -- removed from
  schema. These are personal tools used by the
  analyst, not part of Trident's logic. (Section 6.4)
- ✅ **Long entry example** -- confirmed correct.
  (Section 7.4)
- ✅ **Midpoint offset direction** -- intentional.
  +2 for buys, -2 for sells. Must remain
  configurable. (Section 7.3)
- ✅ **Missing level fallback** -- skip the trade
  entirely when levels are missing. (Section 7.3.1)
- ✅ **180-minute timer start** -- starts from the
  LAST entry filled, and resets each time a new
  entry is executed. (Section 7.5)
- ✅ **Morning vs afternoon levels** -- morning
  levels remain valid until afternoon levels are
  released. (Section 7.8)
- ✅ **One trade per day implication** -- confirmed
  acceptable. (Section 8.1.1)
- ✅ **Hard daily stop** -- corrected from EUR 4,000
  to EUR 800. (Section 8.1)
- ✅ **Broker API** -- cTrader Open API (same
  WebSocket used for price feed, extended to
  send orders in Phase 2). Standalone Node.js
  process throughout -- no native plugin.
  (Section 9.2 and 11.4)
- ✅ **Setup delivery from analyst** -- FB will
  put levels into an Excel file. Engineer to design
  the bridge. (Section 11.4)

### Setup Units -- Cash vs Futures

**Background:** the numbers the analyst (FB)
provides to Trident -- whether typed into
Trident's GUI, pasted into a YAML file, or
entered via Excel -- come from two different
charts, which use two different price units. Some
fields are in **ES futures** terms, and some are
in **SPX cash** (also called `US500.cash`). The
gap between the two is the **basis**, which is
~40-75 points and changes every day.

Trident executes against ES futures (or a
CFD/index tracking them), so every value it
compares against the live price must be in
futures terms. Cash-terms values must be
converted.

(The specific entry mechanism -- GUI, YAML file,
Excel bridge -- doesn't change the units
question. Whichever input path FB uses, the
numbers still come from the same two charts and
carry the same units.)

**Data flow (as FB described on 2026-04-23):**

The signal service publishes a **levels table**
in **ES futures terms** (source of truth). FB
prefers to analyse in SPX cash, so he takes the
futures values, subtracts basis, and plots the
cash-converted levels on an SPX intraday chart.
That SPX chart is where he reads back the numbers
he sends to Trident.

> FB: "Since the instrument I analyze is the SPX
> cash index, I convert the futures values from
> the levels table using the daily spread between
> SPX and futures, and then I plot those
> converted levels on this chart. So, the levels
> you see before is SPX-based levels. However, if
> you switch to a futures chart, you will see
> that price touched exactly the levels from the
> table I sent."

Implication: the cash values he's been sending
are derived from an upstream futures-terms
source. If Trident ingests directly from the
levels table (or FB reads back from the futures
chart instead of the SPX chart), no basis math is
needed in Trident at all.

**Confirmed so far:**

| Field(s) | Upstream source | What FB currently sends | How confirmed |
|----------|-----------------|-------------------------|---------------|
| `ranges.range_1_*`, `ranges.range_2_*` | IV Smile chart (ES futures) | ES futures | FB confirmed 2026-05-04: "expressed in futures prices" |
| `volatility.dvs` | IV Smile chart — RIGHT column (Opening Bell) if available, else LEFT (Morning) | As shown | DVS recalibrated at opening bell like levels; fall back to morning if Opening Bell unavailable |
| `levels.max_buy_1/2`, `levels.max_sell_1/2`, `levels.supporto`, `levels.resistenza` (and same fields in `levels_recal`) | IV Smile chart — range panel (Range 1/2 down/up) | ES futures | Changed 2026-05-12: analyst now uploads single IV Smile chart; levels are populated from the same range panel as `ranges.*` |
| `meta.cash_last` | **Not from IV Smile** | **null (enter manually)** | FB confirmed 2026-05-04: SPX feed unreliable, shows 0.00 |
| `meta.basis` | **Not from IV Smile** | **null (enter manually)** | FB confirmed 2026-05-04: derived from unreliable SPX feed |
| `vwap.value` | TBD | TBD | See Q1 below |

> **[FB resolved 2026-05-04]** `cash_last` and `basis` must NOT be
> extracted from the IV Smile chart. The "SPX Index Last" and
> "Delta p.ti Fut ES-SPX" fields on the IV Smile are unreliable —
> they show 0.00 / garbage when the SPX feed is unavailable (common
> at the US market open). These fields should be left null on screenshot
> import and entered manually or sourced from a live price feed if needed.
> Q3 below is therefore resolved: do not use the IV Smile for basis at all.

**TODO FB:**

- **Q1. VWAP number.** The VWAP number you give
  to Trident (via the GUI, YAML, or Excel --
  whichever we end up using) -- is it the **ES
  futures price** (like 7136), or the **SPX cash
  price** (like 7080)? One word answer is fine.

- **Q2. Sending levels in futures terms
  directly.** Since the levels table you use is
  already in ES futures, could you just enter
  those original futures values (into the GUI,
  YAML, or Excel), instead of the SPX-converted
  ones? That saves Trident from doing basis math
  and avoids rounding drift. Does that work for
  your workflow, or do you strongly prefer
  reading back from your SPX chart?

**Plan (EW -- depends on FB's answer to Q2):**

*Preferred (if FB agrees to Q2):* accept levels
in futures terms directly from the source table.
No conversion in Trident, no basis math in the
signal path, no rounding drift. `meta.basis`
stays in the schema as a recorded sanity-check
value only.

*Fallback (if FB prefers reading back from his
SPX chart):* convert cash -> futures inside the
signal loader:
- `futures_value = cash_value + basis`
- `ranges.*` pass through unchanged (already
  futures).
- Validation runs **after** conversion so every
  downstream comparison is futures-to-futures.
- The persisted record (YAML on disk, and the
  corresponding form inputs in the dashboard)
  keeps the original numbers FB entered (cash
  stays cash as captured) -- faithful to what he
  read, and easy to re-check.
- If we go this way, the dashboard form's level
  inputs should be labelled "(SPX cash)" next to
  the field so it's unambiguous at entry time.

### Open TODOs

These items are still unresolved:

- **TODO FB:** The +20 points management step
  question. FB asked for clarification in the v1.0
  review. Need to re-explain: should Trident
  perform any intermediate action when the
  position reaches +20 points profit, before the
  +25 breakeven trigger fires? (Section 7.5)
- **TODO FB:** Study of multiple exit targets
  (analyst's future enhancement -- currently
  single target mode using VWAP)

### Setup Delivery (EW)

- **TODO EW:** FB will use an Excel file for
  levels. How does QS read it? Direct file watch?
  Bridge service that converts Excel to YAML? Or
  do we ask FB to use YAML directly?
- Does QS poll for new files or get notified?
- How are VWAP updates delivered mid-session?

### Live Price Feed (EW)

- **TODO EW:** Source for live ES / CFD price
  data?
- Free vs paid data feeds (Databento, Massive,
  Tradovate, IBKR, broker-native)
- Latency requirements -- sub-second or 1-5 second
  polling?

### Tradeable Signal Format - Internal Interface (EW)

- **TODO EW:** What data structure does
  qs-signal-engine pass to qs-trader?
- Minimum fields: direction, 3 entry prices + %,
  stop, target (VWAP), hard exit (+33), breakeven
  trigger (+25), time exit, reasoning
- How are updates communicated? ("move stop to
  breakeven", "signal cancelled", "time exit
  triggered")
- Should this be an in-memory interface, a message
  queue, or a file?

### qs-trader Output Format (EW)

- How does qs-trader display signals to the human
  in Phase 1? Telegram? Dashboard? Console?
- What information does the trader need to see?
- How are signal updates shown in real time?

### Multiple Instruments

- Will QS monitor ES, NQ, and DAX simultaneously?
  (The Range Intraday sheet showed all three)
- Or ES only to start?

### Backtesting

- Can the analyst provide historical setup data?
- How will we validate Trident logic before going
  live?

### QS Configuration File (EW)

- The risk/capital parameters (Section 8) and
  Trident-specific parameters (entry allocations,
  offsets, profit targets) should live in a
  separate QS config file, not the setup YAML
- **TODO EW:** Design the QS config schema
- Config is shared by both qs-signal-engine (for
  sizing in signals) and qs-trader (for
  broker-level risk limits in Phase 2)
- Note: Trident's midpoint offset (+2 / -2) must
  be a configurable parameter per FB's request

### Automating the Analyst (Phase 3)

- What raw data source would replicate the signal
  service?
- Can the analyst eventually share the level
  calculation formula?
- What options data feeds are available?
- Long-term goal -- not blocking v1

---

## 11. Architecture Considerations (Preliminary)

> **NOTE:** Starting point for discussion, not
> final.

### 11.1 High-Level Components

```
         INPUTS
┌──────────────┐  ┌──────────────┐
│  Setup        │  │  Price Feed   │
│  Ingestion    │  │  Service      │
│  (YAML/Excel) │  │  (Live ES)    │
└──────┬───────┘  └──────┬───────┘
       │                 │
       ▼                 ▼
┌────────────────────────────────┐
│     QUANTUM SAGE               │
│                                │
│  ┌──────────────────────────┐  │
│  │  qs-signal-engine        │  │
│  │  (Trident strategy)      │  │
│  │                          │  │
│  │  ┌─────────┐ ┌────────┐ │  │
│  │  │ Setup   │ │ DVS    │ │  │
│  │  │ Valid.  │ │ Gate   │ │  │
│  │  └─────────┘ └────────┘ │  │
│  │                          │  │
│  │  ┌─────────┐ ┌────────┐ │  │
│  │  │ Level   │ │ 3-Entry│ │  │
│  │  │ Monitor │ │ Engine │ │  │
│  │  └─────────┘ └───┬────┘ │  │
│  │                   │      │  │
│  │  ┌─────────┐ ┌───┴────┐ │  │
│  │  │ Risk    │ │ Exit   │ │  │
│  │  │ Manager │ │ Logic  │ │  │
│  │  └─────────┘ └────────┘ │  │
│  │                          │  │
│  │  ┌─────────┐            │  │
│  │  │ Audit   │            │  │
│  │  │ Logger  │            │  │
│  │  └─────────┘            │  │
│  └────────────┬─────────────┘  │
│               │                │
│               │ Tradeable      │
│               │ signal         │
│               │ (internal      │
│               │  interface)    │
│               ▼                │
│  ┌──────────────────────────┐  │
│  │  qs-trader               │  │
│  │                          │  │
│  │  Phase 1: Manual output  │  │
│  │  (Telegram, dashboard)   │  │
│  │                          │  │
│  │  Phase 2: auto via       │  │
│  │  cTrader Open API        │  │
│  └────────────┬─────────────┘  │
│               │                │
└───────────────┼────────────────┘
                │
                ▼
       ┌──────────────┐
       │ BROKER /     │
       │ EXCHANGE     │
       └──────────────┘
```

### 11.2 Two Config Inputs

QS has two separate configuration inputs:

**Setup File (changes daily/intraday):**
- Levels, VWAP, DVS, ranges, bias
- Produced by the analyst (Excel, converted to
  YAML or read directly)
- Consumed by qs-signal-engine

**QS Config File (changes rarely):**
- Starting capital, daily risk %, stop distance
- Trident entry allocations (32.5 / 35.0 / 32.5)
- Trident entry offsets (0 / 2 / 0)
- Trident midpoint offset (+2 buy / -2 sell --
  configurable per FB)
- Profit targets (+33 hard, +25 breakeven)
- Time exit (180 minutes)
- Size adaptation rules (50% / 25% after losses)
- Soft/hard daily loss limits
- Consumed by both qs-signal-engine (for sizing
  calculations in signals) and qs-trader (for
  broker-level risk enforcement)

> **TODO EW:** Design the QS config schema.

### 11.3 Technology Stack

> **TBD** -- Candidates:
> - Python (rich financial ecosystem, easy YAML
>   parsing, rapid prototyping)
> - TypeScript/Node.js (event-driven, good for
>   real-time dashboards)
> - TypeScript/Node.js is the confirmed stack;
>   broker integration via cTrader Open API

### 11.4 Execution Strategy

**Approach (Phase 2):**

The system is a standalone Node.js process
throughout. Phase 2 extends the existing
cTrader Open API connection (currently read-only
for price ticks) to also send orders:

1. qs-signal-engine generates a tradeable signal
   (entry price, direction, stop, size)
2. qs-trader translates that into a cTrader
   Open API order message (ProtoOANewOrderReq
   or similar) sent over the existing WebSocket
3. The broker confirms fill / rejection; qs-trader
   relays the result back to qs-signal-engine for
   state tracking
4. Setup file format and all strategy logic remain
   unchanged -- only the output path changes
   (console/dashboard → API call)

**Why standalone API over native plugin:**

- The cTrader Open API already provides price feed,
  order execution, account info, and position
  management -- no need to run inside the platform
- One codebase, one deployment -- no reimplementation
  in cAlgo C# or MQL
- Easier to test, log, and iterate outside the
  platform sandbox

> **[FB resolved]** Setup delivery: FB will put
> the levels into an Excel file for the moment.
> The engineer needs to design how QS reads from
> Excel (file watcher, bridge service to convert
> to YAML, or direct Excel parsing inside the
> platform).

### 11.5 Deployment

> **TBD** -- Local machine, cloud VPS, or
> dedicated trading server.

---

## 12. Glossary

| Term       | Definition                          |
|------------|-------------------------------------|
| QS         | Quantum Sage -- the umbrella system |
|            | for trading strategies              |
| Trident    | The first strategy under QS.        |
|            | Intraday mean-reversion on S&P 500  |
|            | with three-entry scaling and VWAP   |
|            | target                              |
| qs-signal- | QS module: the brain. Ingests       |
| engine     | setups, watches price, generates    |
|            | tradeable signals                   |
| qs-trader  | QS module: the hands. Displays      |
|            | signals (manual) or executes them   |
|            | via broker API (auto)               |
| DVS        | Directional Volatility Score        |
| ES         | E-mini S&P 500 futures              |
| SPX        | S&P 500 cash index                  |
| Basis      | ES minus SPX spread (cost of carry) |
| IV Smile   | IV curve across option strikes      |
| SELL OUTER | Outer resistance level (Range 1 up) |
|            | → Short Entry 3. Formerly MAX SELL 1|
| SELL INNER | Inner resistance (Range 2 up)       |
|            | → Short Entry 1. Formerly MAX SELL 2|
| BUY INNER  | Inner support (Range 2 down)        |
|            | → Long Entry 1. Formerly MAX BUY 2  |
| BUY OUTER  | Outer support (Range 1 down)        |
|            | → Long Entry 3. Formerly MAX BUY 1  |
| SUPPORTO   | Options-derived support pivot       |
| RESISTENZA | Options-derived resistance pivot    |
| SKEW       | Tail risk premium index             |
| VWAP       | Volume Weighted Average Price --    |
|            | primary take-profit target          |
| Range 1    | Outer expected price boundaries     |
| Range 2    | Inner expected price boundaries     |
| Coast to   | Full move from BUY/SELL levels to VWAP |
| Coast      |                                     |
| CFD        | Contract for Difference             |
| Setup      | YAML file -- QS's sole input        |
| File       |                                     |
| DVS Gate   | Hard rule: no trades if DVS > 75    |
| Three-Entry| Trident's structure: scaling into   |
| Structure  | a position at 3 levels              |
|            | (32.5% / 35% / 32.5%)              |
| Breakeven  | Stop moved to entry after +25 pts   |

---

## 13. Appendices

### Appendix A: Setup File Example

See [qs_setup_2026-04-02_1006.yaml](./research/sample-signal-files/qs_setup_2026-04-02_1006.yaml)
for an annotated example with inline comments
showing where each value originates on the
analyst's charts.

### Appendix B: DVS Thresholds

From the analyst's documentation:

- Below 50: Low vol, sideways, limited oscillation
- 50 to 75: Moderate, movements but no clear bias
- Above 75: **No trades allowed** (Trident rule)

DVS is combined with VWAP (directional
confirmation), volatility curves (compression /
expansion), and options volume (institutional
activity).

### Appendix C: Basis Conversion

- `cash_price = futures_price - basis`
- `futures_price = cash_price + basis`

Basis is positive in normal conditions. Changes
daily. Recent range: 40-75 points.

### Appendix D: Trident Entry Allocation Parameters

| Parameter            | Value  |
|----------------------|--------|
| Entry 1 allocation   | 32.5%  |
| Entry 2 allocation   | 35.0%  |
| Entry 3 allocation   | 32.5%  |
| Entry 1 offset       | 0 pts  |
| Entry 2 offset       | 2 pts  |
| Entry 3 offset       | 0 pts  |
| Midpoint shift (buy) | +2 pts |
| Midpoint shift (sell)| -2 pts |
| Stop loss            | 40 pts |
| Breakeven trigger    | +25 pts|
| Hard profit exit     | +33 pts|
| Time exit (from last | 180 min|
| fill)                |        |

### Appendix E: Position Size Adaptation

| Condition            | Next Day Size     |
|----------------------|-------------------|
| Normal               | 100%              |
| After 1 loss day     | 50%               |
| After 2 loss days    | 25%               |
| After profit day     | Recalc to equity  |

### Appendix F: Source Documents

- Analyst's signal service screenshots
  (March 31 and April 1-2, 2026)
- Analyst's DVS educational documentation
- "Three Level VWAP Reversion System Rules"
  first draft specification (02/04/2026)
- FB's PR review comments (April 2026)

### Appendix G: Related Documents

- [Architecture](../../ARCHITECTURE.md) —
  component map, data flow, technology stack, and
  key design invariants for the qs-signal-engine.

- [Phase 1 Analyst Guide](PHASE_1_ANALYST_GUIDE.md) —
  step-by-step walkthrough of the analyst workflow:
  reading the IV Smile, filling the dashboard form,
  and submitting a setup to the engine.

---

*End of document. This PRD is a living document
and will be updated as decisions are made and the
system evolves.*
