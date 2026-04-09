# Trident: Quantum Sage Strategy -- Product Requirements Document

> **Status:** DRAFT v1.0
> **Last updated:** April 2, 2026
> **Authors:** Filippd Baldan/Emmett Walsh
> **Stage:** Early design -- many decisions are provisional
> and subject to change.
> **Source docs:** analyst's signal service screenshots,
> DVS documentation, and "Three Level VWAP Reversion
> System Rules" first draft spec (02/04/2026).

---

## Table of Contents

1. Overview
2. Background and Context
3. System Concept
4. Roles and Responsibilities
5. The Signal File (Data Contract)
6. Key Data Points and Their Meaning
7. Trading Logic
8. Risk and Capital Management
9. Instruments and Execution
10. Open Questions and TODOs
11. Architecture Considerations (Preliminary)
12. Glossary
13. Appendices

---

## 1. Overview

Trident is the first trading strategy under the Quantum Sage (QS) umbrella. It is a trading system for S&P 500
instruments (ES futures, CFDs, or options) that
processes discretionary analysis **initially provided
by a human analyst** and manages the full lifecycle
from signal generation to trade execution.

The Trident strategy implements an **intraday mean-reversion
system** built around predefined buy and sell levels,
with VWAP as the primary take-profit target. Positions
are built through a three-entry scaling-in structure
with tightly controlled downside risk.

Trident is composed of two modules:

- **qs-signal-engine** -- the brain. Ingests the
  analyst's signal file, watches live price, applies
  the Trident mean-reversion logic, and generates tradeable signals
  (direction, entries, stops, targets). This is the
  Phase 1 priority.
- **qs-trader** -- the hands. Takes tradeable signals
  from qs-signal-engine and executes them. Initially
  this means displaying signals for a human to act on
  manually. Later, it connects to a broker API for
  automated execution. This is a Phase 2 addition.

Both modules live under the Quantum Sage umbrella. They
communicate through a well-defined internal interface
(the tradeable signal), so qs-signal-engine can be
built and validated independently before qs-trader
is wired up.

Trident is NOT a fully autonomous system. In its initial
phase, it depends on human-generated signals and
operates within strict boundaries defined by the
analyst.

### 1.1 Core Principle

> Capital protection comes first. Entry logic matters,
> but survival logic matters more.

### 1.2 Long-Term Vision

The current architecture assumes a human analyst
producing the signal file manually, with a human
trader executing the signals.

**Phase 2** adds automated execution -- qs-trader
connects to a broker API so the human trader is no
longer needed in the loop.

**Phase 3** goes further by automating the analyst's
role as well -- replacing the manual chart reading
and level extraction with an automated pipeline that
ingests raw options data, computes the IV smile,
derives DVS/ranges/levels, and generates the signal
file programmatically.

This is why the signal file (data contract) is
designed as a clean interface between the two halves
of the system. When the analyst side is eventually
automated, QS core logic does not need to change --
it still consumes the same YAML schema regardless of
whether a human or a machine produced it.

**Phase 1 (current):**
  Human analyst --> Signal file --> qs-signal-engine
  --> qs-trader (manual mode) --> Human executes

**Phase 2 (future):**
  Human analyst --> Signal file --> qs-signal-engine
  --> qs-trader (auto mode) --> Broker API

**Phase 3 (future):**
  Automated analysis --> Signal file -->
  qs-signal-engine --> qs-trader (auto mode) -->
  Broker API

---

## 2. Background and Context

### 2.1 The Analyst's System

The analyst uses a proprietary signal service that
derives trading levels from SPX options market data.
The core inputs are:

- **Implied Volatility Smile** -- the distribution of
  implied volatility across SPX option strikes,
  updated intraday
- **Options positioning** -- where large institutional
  participants have clustered their bets (calls, puts,
  open interest)
- **VWAP** -- used to confirm whether the market is
  building positions in a specific direction

From this data, the signal service produces:

- Expected price ranges for the session (Range 1 and
  Range 2 boundaries)
- Key support/resistance levels derived from options
  flow (MAX SELL 1/2, MAX BUY 1/2, CALL, CASH,
  SUPPORTO, RESISTENZA)
- A Directional Volatility Score (DVS) that
  characterizes the expected volatility regime
- SKEW index readings for tail risk assessment

The analyst reviews these outputs, applies
discretionary judgment, and produces a signal file
for Trident.

### 2.2 Origin of Levels

All levels originate from the signal service's
analysis of SPX options data. The service calculates
levels at two key times:

- **Europe morning ** -- initial levels
  based on overnight/morning data
- **Europe mid-afternoon ** -- recalibrated
  levels at the US market open (Opening Bell)

Levels from the signal service may be expressed in
either futures or cash (SPX) terms depending on the
chart. When in SPX terms, a daily basis (cost of carry
spread) must be applied to convert to futures prices.
This basis changes daily due to dividends and interest
rates. Recent observed range: approximately 40-75
points.

### 2.3 The "Coast to Coast" Concept

The analyst's primary trade concept is "coast to
coast" -- entering near a MAX BUY zone and riding the
move up to VWAP (for longs), or entering near MAX SELL
and riding down to VWAP (for shorts). The levels
define the battlefield; the trade is about capturing
the mean-reversion move back toward VWAP.

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
│   Fills signal file       │
└─────────────┬─────────────┘
              │
              │  Signal YAML file
              │  (the data contract)
              ▼
┌─────────────────────────────────┐
│     QUANTUM SAGE (Trident)      │
│                                 │
│  ┌───────────────────────────┐  │
│  │   qs-signal-engine        │  │
│  │   Validates signal        │  │
│  │   Watches live price      │  │
│  │   Applies Trident three-  │  │
│  │     entry mean-reversion  │  │
│  │     logic                 │  │
│  │   Generates tradeable     │  │
│  │     signals               │  │
│  │   (Trident implementation)│  │
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
│  │   Phase 2: auto-execute   │  │
│  │     via broker API        │  │
│  │     (IBKR, MT4/5, etc.)  │  │
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

- **Trident is a Quantum Sage strategy.** Both
  qs-signal-engine and qs-trader live under the
  Quantum Sage (QS) umbrella.
- **Clean separation of concerns.** The analyst (or
  future automated pipeline) owns the "what" (levels,
  bias, regime). qs-signal-engine owns the "when"
  (applying Trident logic to determine trade opportunities).
  qs-trader owns the "how" (getting orders to market).
- **Internal interface between modules.** The
  tradeable signal is a well-defined data structure
  passed from qs-signal-engine to qs-trader. This
  allows each module to be developed and tested
  independently.
- **The signal file is a stable external interface.**
  Whether a human or a machine produces it, the
  Trident engine consumes the same schema.
- **Trident is useful from day one.** qs-signal-engine can
  run standalone, outputting signals to a human via
  qs-trader in manual mode. Automated execution is
  added later without changing qs-signal-engine.

---

## 4. Roles and Responsibilities

### 4.1 The Analyst (Phase 1 -- Human (FB))

- Reviews IV smile charts, options positioning, and
  intraday execution charts
- Determines the day's volatility regime and
  directional bias
- Identifies key levels (MAX SELL 1/2, MAX BUY 1/2,
  CALL, CASH, SUPPORTO, RESISTENZA)
- Updates VWAP periodically (roughly once per hour)
- Fills in the signal YAML file with all required
  fields
- May issue updated signals intraday (e.g. after
  15:36 recalibration)
- Sets invalidation boundaries and event risk notes

> **Phase 3 note:** In the future, this role will be
> replaced by an automated pipeline. The signal file
> schema remains the same -- only the producer changes.

### 4.2 qs-signal-engine (Phase 1 Priority)

The brain of the Trident strategy. Responsible for all trading logic
and signal generation.

- Validates the signal file against the schema
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
  - Time-based exit (180 minutes from first fill)
  - Reasoning (why this trade was generated)
- Tracks active signals and updates them (breakeven
  moves, time exits, invalidations)
- Enforces one-winning-trade-per-day rule
- Logs every decision for auditability
- Passes tradeable signals to qs-trader via internal
  interface

### 4.3 qs-trader (Phase 1 Manual, Phase 2 Auto)

The hands of Trident. Responsible for getting signals
in front of a human or into a broker.

**Phase 1 (manual mode):**
- Receives tradeable signals from qs-signal-engine
- Displays them for human consumption (Telegram
  alert, dashboard, console output, etc.)
- Receives signal updates (breakeven triggered,
  time exit, invalidation) and displays those too
- Human trader decides whether to act

**Phase 2 (automated mode):**
- Same internal interface from qs-signal-engine
- Translates tradeable signals into broker API
  orders (market, limit, stop)
- Manages position lifecycle (fills, partials,
  cancellations)
- Enforces broker-level risk limits (margin, daily
  loss cap)
- Reports execution status back for logging

### 4.4 Engineer/Developer (EW)

- Builds and maintains Trident
- Defines and tunes trading logic parameters
- Integrates with price feed for live data
- Monitors system health and performance
- Iterates based on backtesting and live results

---

## 5. The Signal File (Data Contract)

### 5.1 Format

- **Format:** YAML
- **Encoding:** UTF-8
- **Schema version:** 1.0
- **Naming:** `qs_signal_YYYY-MM-DD_HHmm.yaml`
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
`qs_signal_2026-04-02_1006.yaml`.

Summary of sections:

| Section      | Purpose                         |
|--------------|---------------------------------|
| meta         | Date, time, contract, prices,   |
|              | basis, execution instrument     |
| volatility   | DVS, SKEW, regime               |
| vwap         | Current VWAP value and          |
|              | update timestamp                |
| ranges       | Range 1/2 boundaries            |
| levels       | MAX SELL/BUY, CALL, CASH,       |
|              | SUPPORTO, RESISTENZA            |
| levels_recal | Optional 15:36 recalibration    |
| bias         | Optional analyst directional    |
|              | overlay                         |
| invalidation | Void prices, expiry, event risk |

**New in v1.0:** VWAP section added as the primary
take-profit target. Bias section marked as optional
overlay since the system is primarily rule-based.

### 5.4 Validation Rules

- All required fields present
- Range ordering correct
  (range_1_down < range_2_down < range_2_up <
  range_1_up)
- All prices positive and within 20% of futures_last
- Basis math: futures_last - cash_last ≈ basis
  (±5 tolerance -- wide enough to handle the
  analyst reading futures and cash prices at
  slightly different times, tight enough to catch
  fat-finger errors like 143 instead of 43. May
  tighten to ±2 or ±3 after observing real data.)
- DVS within 0-200 range
- DVS gate: if DVS > 75, Trident should flag "no trade
  day" immediately
- VWAP present and reasonable
- Enum fields valid
- Invalidation boundaries sensible
- Signal not stale

---

## 6. Key Data Points and Their Meaning

### 6.1 DVS (Directional Volatility Score)

A measure of expected directional volatility.

| DVS       | Regime     | Trident Action         |
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
> The system is purely mean-reversion, so high vol
> environments are avoided entirely.

Additional insight: if DVS is compressing through
the session (current < prior), conditions are
improving for this system. If expanding, conditions
are deteriorating.

### 6.2 VWAP

**The primary take-profit target for all Trident trades.**

VWAP (Volume Weighted Average Price) represents the
average price weighted by volume. In a mean-reversion
system, price is expected to return to VWAP after
deviating to the MAX BUY or MAX SELL zones.

VWAP is currently entered manually by the analyst
and updated roughly once per hour.

> **TODO FB:** Determine whether Trident should calculate
> VWAP from the live price feed (more accurate, no
> manual updates needed) or continue relying on the
> analyst's manual input. If Trident calculates it, the
> signal file field becomes a fallback/validation
> reference.

### 6.3 Range Levels

Expected price boundaries from the IV smile.

- **Range 1** (outer) -- 75% historical re-entry
  rate. Price comes back inside 3 out of 4 times.
- **Range 2** (inner) -- tighter zone where price
  spends most of its time.

Low DVS = higher confidence price stays in Range 1.
High DVS = more likely to break out and stay out.

### 6.4 Key Levels (Entry Triggers)

| Level      | Role               | Description        |
|------------|--------------------|--------------------|
| MAX SELL 1 | Resistance (outer) | Short Entry 3      |
| MAX SELL 2 | Resistance (inner) | Short Entry 1      |
| MAX BUY 2  | Support (inner)    | Long Entry 1       |
| MAX BUY 1  | Support (outer)    | Long Entry 3       |
| CALL       | Reference  ??      | Call wall strike    |
| CASH       | Reference  ??      | Cash ref level     |
| SUPPORTO   | Support pivot      | Options-derived    |
| RESISTENZA | Resistance pivot   | Options-derived    |

> **TODO FB:** Confirm with analyst that MAX BUY 2 /
> MAX BUY 1 map to Long Entry 1 / Entry 3
> respectively (inner first, outer last). Same for
> MAX SELL 2 / MAX SELL 1 mapping to Short Entry 1 /
> Entry 3. This mapping is our assumption based on
> the three-entry spec.
> 
> **TODO FB:** What exactly are the CALL and CASH levels on 
> your intraday chart, and do they play any role in the 
> trading logic or are they just visual references?

Levels are calculated at European morning and optionally
recalibrated at European mid afternoon.

### 6.5 SKEW Index

Measures tail risk premium. Higher = more downside
protection being bought. Exact QS usage TBD.

### 6.6 Basis (ES-SPX Spread)

`futures_price - basis = cash_price`

Changes daily. Recent range: 40-75 points.

---

## 7. Trading Logic

> **Source:** Analyst's "Three Level VWAP Reversion
> System Rules" first draft, 02/04/2026. Some rules
> are confirmed, others are marked as needing
> testing/confirmation.

### 7.1 System Type

This is an **intraday mean-reversion system**.

- Trades are built around predefined buy or sell
  levels
- VWAP is the primary take-profit target
- Positions are built through three separate entries
- The system does NOT trade breakouts or trends
- If DVS > 75, no trades are taken at all

### 7.2 DVS Gate (Pre-Trade Check)

Before any trade logic runs:

- If DVS > 75 --> **no trades for the day**
- This is a hard gate, not a soft filter
- The system is designed for mean-reversion only;
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
> the signal file (as MAX BUY/SELL levels). Entry 2
> is **calculated by qs-signal-engine** at runtime
> from those two levels. It does not appear in the
> YAML.

> **TODO FB (offset direction):** For a long trade,
> adding +2 to the midpoint makes it *higher*
> (closer to Entry 1, further from Entry 3). This
> means Entry 2 is biased toward getting filled
> rather than toward maximum depth into the dip.
> Confirm with analyst: is this intentional, or
> should the offset go the other direction (-2 for
> buys, +2 for sells) to scale in deeper?

**Entry offsets** (BuyEntryOffsetPoints /
SellEntryOffsetPoints) allow the system to enter
slightly before the exact level is reached:
- Entry 1 offset: 0 points
- Entry 2 offset: 2 points
- Entry 3 offset: 0 points

**No additional averaging** is allowed beyond the
third entry.

### 7.3.1 Missing Level Fallback

If one of the two source levels is null in the
signal file (e.g. max_buy_1 is not shown on the
analyst's chart), qs-signal-engine cannot calculate
the midpoint and cannot build the full three-entry
structure.

> **TODO FB (critical):** Define fallback behavior when
> a level is missing. Options include:
> - **Skip the trade entirely** -- safest, no entry
>   if the full three-level structure can't be built
> - **Two-entry mode** -- enter at the available
>   level (Entry 1) and skip Entry 2 and Entry 3,
>   with adjusted allocation (e.g. 50% / 50% or
>   100% single entry)
> - **Analyst override** -- analyst provides an
>   explicit substitute level in the signal file's
>   `additional` field
>
> This must be resolved before qs-signal-engine can
> handle real-world signal files where levels are
> sometimes absent.

### 7.4 Long Entry Example

Given MAX BUY 2 = 6467 and MAX BUY 1 = 6440:

- Entry 1: 6467.00 (MAX BUY 2, 32.5%)
- Midpoint: (6467 + 6440) / 2 + 2 = 6455.50
- Entry 2: 6455.50 (midpoint + 2, 35.0%)
- Entry 3: 6440.00 (MAX BUY 1, 32.5%)
- Stop: 40 points below average entry price
- Target: VWAP

> **TODO FB:** Confirm this example with the analyst.
> Verify the level-to-entry mapping.

### 7.5 Exit Strategy

**Primary take-profit: VWAP**
- The main target for all trades is VWAP
- The full position is closed when VWAP is reached

**Hard profit exit: +33 points**
- If the position reaches +33 points from average
  entry, close immediately
- Even if VWAP has not been reached yet
- This is an **emergency profit cap**, not the
  primary target. In normal operation, VWAP will be
  hit first (step 4 in priority order). The +33
  exit only fires if VWAP is unusually far from
  entry and price runs hard before reaching it.

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
  target within 180 minutes from the first filled
  entry, exit at market

> **TODO FB:** Confirm whether the 180-minute timer
> starts from the first fill or the final fill.
> Analyst's doc flags this as needing confirmation.

> **TODO FB:** Analyst mentions a possible additional
> management step around +20 points. To be confirmed
> in testing.

### 7.6 Daily Lock After Winning Trade

- If the system closes one profitable trade, **no
  more trades are allowed for the rest of the day**
- This is a hard rule

### 7.7 Overnight Exception

- The system may hold a position overnight ONLY if
  the final entry level (Entry 3) is triggered during
  the last trading hour (21:00-22:00)
- In that case, the position must be closed no later
  than 07:00 the following morning

### 7.8 Morning vs Afternoon Levels

- If not triggered, morning levels remain
  valid until the afternoon levels are released
- Once afternoon levels are published, untriggered
  morning levels are invalidated and replaced

> **TODO FB:** Analyst flags this rule as needing
> confirmation through testing before treating as
> final.

### 7.9 System Logic Priority

Trident should evaluate in this order:

1. Risk limit checks (daily loss, DVS gate)
2. Trade eligibility checks (daily lock, session
   time, signal validity)
3. Entry execution by level (three-entry structure)
4. VWAP and target monitoring
5. Breakeven activation above +25 points
6. Full close at +33 points
7. Time-based exit after 180 minutes
8. Daily lock after one winning trade

---

## 8. Risk and Capital Management

> **Source:** Analyst's system spec. These are the
> proposed starting parameters.

### 8.1 Capital and Daily Risk

| Parameter              | Value             |
|------------------------|-------------------|
| Starting capital       | EUR 80,000        |
| Daily risk %           | 0.5%              |
| Soft daily stop        | EUR 400           |
| Hard daily stop        | EUR 4,000         |

- Position size is calculated so that the maximum
  loss at stop loss (40 points) does not exceed the
  daily risk limit (EUR 400)
- The EUR 4,000 hard limit is an emergency line and
  should NOT be used as the normal operating
  threshold
- If the soft daily stop (EUR 400) is reached,
  trading stops for the day under normal conditions

### 8.1.1 Effective "One Trade Per Day" Implication

The combination of these rules means that under
normal operation, **Trident effectively takes one trade
per day:**

- If the trade wins --> daily lock (Section 7.6)
  prevents further trades
- If the trade loses at the 40-point stop --> the
  loss equals the soft daily stop (EUR 400), so
  trading stops

This makes the EUR 4,000 hard daily stop an
**emergency backstop only** -- it would only be
reached through slippage, gap risk, overnight holds
gone wrong, or broker-level failures. Under normal
logic it is unreachable.

> **TODO FB (confirm with analyst):** Is this "one and
> done" behavior intentional? If so, the PRD should
> state it explicitly as a design choice. If the
> analyst expects multiple trade attempts per day,
> then either the soft daily stop needs to be higher
> than the per-trade risk, or the per-trade size
> needs to be a fraction of the soft daily stop.

> **NOTE:** These are Trident configuration parameters,
> NOT part of the signal file. They live in a
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
  40-point stop does not exceed the daily risk limit

### 8.4 Profit Protection

- At +25 points profit: move stop to breakeven
  (average entry price)
- At +33 points profit: close entire position
  immediately

### 8.5 Financial Risk Warnings

- Trident generates signals that lead to real-money
  trades. Every bug is a potential financial loss.
- Paper trading phase is mandatory before live
  deployment.
- Daily loss limits must be enforced at both the Trident
  level AND at the broker level.
- Invalidation logic must be bulletproof.

### 8.6 Technical Risk

- Price feed outage -- Trident must detect and halt
- Signal file corruption -- validation catches this
- Clock drift -- timestamps matter for 180-min
  timer and signal expiry
- Network issues -- Trident should not assume permanent
  connectivity

### 8.7 Operational Risk

- Stale signals -- must not trade yesterday's levels
- Fat finger in signal file -- validation is safety
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
- **SPX options** -- possible but not primary use case

### 9.2 Broker / Execution (qs-trader)

> **Phase 1:** qs-trader operates in manual mode --
> displays Trident signals for human execution. No broker
> connection needed.
>
> **Phase 2:** qs-trader connects to a broker API.
> Options include:
> - Interactive Brokers (IBKR) API -- most common
>   for ES futures
> - MetaTrader 4/5 -- common for CFDs
> - TradeStation, NinjaTrader, or others
>
> Broker choice shapes qs-trader internals but does
> not affect qs-signal-engine.

### 9.3 Currency

Starting capital is denominated in EUR. Profit/loss
on ES futures is in USD. Currency conversion
implications TBD.

---

## 10. Open Questions and TODOs

### Confirmed TODOs (from analyst's spec)

These items are explicitly flagged by the analyst
as needing confirmation or testing:

- **TODO FB:** Whether afternoon levels always
  invalidate morning levels, or only when morning
  levels were not triggered (Section 7.8)
- **TODO FB:** Whether the 180-minute timer starts from
  the first fill or the final fill (Section 7.5)
- **TODO FB:** Whether an additional management step
  should be added around +20 points profit
  (Section 7.5)
- **TODO FB:** Study of multiple exit targets (analyst's
  future enhancement -- currently single target
  mode using VWAP)

### Level Mapping

- **TODO FB:** Confirm that MAX BUY 2 / MAX BUY 1 map
  to Long Entry 1 / Entry 3 respectively (inner
  level first touched, outer level last). Same for
  MAX SELL side. (Section 6.4)
- **TODO FB:** Verify the long entry example calculation
  with the analyst (Section 7.4)

### Entry 2 Offset Direction

- **TODO FB (from review):** The +2 offset on the buy
  side midpoint makes Entry 2 higher (closer to
  Entry 1), not deeper into the dip. Is this
  intentional? Or should it be -2 for buys and +2
  for sells to scale in deeper? (Section 7.3)

### Missing Level Fallback

- **TODO FB (critical):** What should qs-signal-engine
  do when one of the two source levels is null?
  (e.g. max_buy_1 not shown on chart). Options:
  skip trade, two-entry mode, or analyst provides
  substitute level. No fallback logic is currently
  defined. (Section 7.3.1)

### One Trade Per Day Implication

- **TODO FB (confirm with analyst):** The risk math
  means one losing trade = soft daily stop reached.
  Combined with daily lock after one winning trade,
  this makes Trident effectively a "one trade per day"
  system. Is this intentional? (Section 8.1.1)

### VWAP

- **TODO FB:** Should Trident calculate VWAP from the live
  price feed, or rely on analyst's manual updates?
  If live, the signal file VWAP becomes a
  fallback/validation reference. (Section 6.2)

### Signal Delivery

- All TODO by Emmett - How does the analyst deliver the signal file?
- Options: shared folder, git push, Telegram bot,
  direct upload
- Does QS poll for new files or get notified?
- How are VWAP updates delivered mid-session?
  (New signal file each time? Separate channel?)

### Live Price Feed

- Source for live ES / CFD price data?
- Free vs paid data feeds
- Latency requirements -- sub-second or 1-5 second
  polling?

### Broker Integration (qs-trader Phase 2)

- Which broker API will qs-trader connect to?
- Paper trading / sandbox for testing?
- Order types -- market, limit, stop?
- NOT needed for Phase 1 -- qs-trader starts in
  manual mode (display only)

### Tradeable Signal Format (Internal Interface) - TBD by Emmett

- What data structure does qs-signal-engine pass
  to qs-trader?
- Minimum fields: direction, 3 entry prices + %,
  stop, target (VWAP), hard exit (+33), breakeven
  trigger (+25), time exit, reasoning
- How are updates communicated? ("move stop to
  breakeven", "signal cancelled", "time exit
  triggered")
- Should this be an in-memory interface, a message
  queue, or a file?

### qs-trader Output Format

- How does qs-trader display signals to the human
  in Phase 1? Telegram? Dashboard? Console?
- What information does the trader need to see?
- How are signal updates shown in real time?

### Multiple Instruments

- Will Trident monitor ES, NQ, and DAX simultaneously?
  (The Range Intraday sheet showed all three)
- Or ES only to start?

### Backtesting

- Can the analyst provide historical signal data?
- How will we validate Trident logic before going live?

### QS Configuration File (EMMETT TODO)

- The risk/capital parameters (Section 8) should
  live in a separate QS config file, not the signal
  YAML
- **TODO EW:** Design the QS config schema
  (starting capital, daily risk %, stop distance,
  profit targets, entry allocations, size
  adaptation rules)
- Config is shared by both qs-signal-engine (for
  sizing in signals) and qs-trader (for broker-level
  risk limits in Phase 2)

### Automating the Analyst (Phase 3)

- What raw data source would replicate the signal
  service?
- Can the analyst eventually share the level
  calculation formula?
- What options data feeds are available?
- Long-term goal -- not blocking v1

---

## 11. Architecture Considerations (Preliminary)

> **NOTE:** Starting point for discussion, not final.

### 11.1 High-Level Components

```
         INPUTS
┌──────────────┐  ┌──────────────┐
│  Signal       │  │  Price Feed   │
│  Ingestion    │  │  Service      │
│  (YAML)       │  │  (Live ES)    │
└──────┬───────┘  └──────┬───────┘
       │                 │
       ▼                 ▼
┌────────────────────────────────┐
│     QUANTUM SAGE               │
│                                │
│  ┌──────────────────────────┐  │
│  │  qs-signal-engine        │  │
│  │                          │  │
│  │  ┌─────────┐ ┌────────┐ │  │
│  │  │ Signal  │ │ DVS    │ │  │
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
│  │  Phase 2: Broker API     │  │
│  │  (IBKR, MT4/5, etc.)   │  │
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

The Trident strategy has two separate configuration inputs:

**Signal File (changes daily/intraday):**
- Levels, VWAP, DVS, ranges, bias
- Produced by the analyst
- Consumed by qs-signal-engine

**QS Config File (changes rarely):**
- Starting capital, daily risk %, stop distance
- Entry allocations (32.5 / 35.0 / 32.5)
- Entry offsets (0 / 2 / 0)
- Profit targets (+33 hard, +25 breakeven)
- Time exit (180 minutes)
- Size adaptation rules (50% / 25% after losses)
- Soft/hard daily loss limits
- Consumed by both qs-signal-engine (for sizing
  calculations in signals) and qs-trader (for
  broker-level risk enforcement)

> **TODO EMMETT:** Design the QS config schema. EMMETT

### 11.3 Technology Stack

> **TBD** -- Candidates:
> - Python (rich financial ecosystem, easy YAML
>   parsing, rapid prototyping)
> - TypeScript/Node.js (event-driven, good for
>   real-time dashboards)
>
> Broker API compatibility is NOT a constraint for
> Phase 1 since qs-trader starts in manual mode.
> Choose the best stack for qs-signal-engine first.


### 11.4 Platform Strategy

### 11.x Platform Strategy

> **TODO (key architectural decision):** Should the Trident
> strategy run as an independent standalone process, or be
> implemented natively inside a/each trading platform?

**Option A: Standalone process (Python/TypeScript)**

Pros:
- Full control over the stack
- Broker/platform agnostic
- Easier to test and debug
- Natural fit for the two-module architecture

Cons:
- Must self-manage a live price feed (single point
  of failure, reconnection handling, stale data
  risk)
- Must build broker connectivity from scratch
- More infrastructure to maintain

**Option B: Native platform implementation
(MQL5, Pine Script, etc.)**

Pros:
- Price feed is built in and reliable -- someone
  else's problem
- Order execution is built in
- Backtesting tools come free
- AI-assisted porting (e.g. Opus) makes
  reimplementing for multiple platforms feasible

Cons:
- Locked to platform's language and constraints
- Pine Script is limited for file ingestion and
  complex state management
- MQL5 is more capable but ties you to MetaTrader
- Porting to a new platform means a rewrite
  (though AI makes this manageable)

**Proposed approach:**

1. Write the canonical qs-signal-engine logic once
   in Python as the reference implementation and
   test harness (validation, backtesting, rule
   confirmation)
2. Port qs-signal-engine to the analyst's actual
   trading platform (MQL5, Pine, or other) using
   AI-assisted translation
3. qs-trader comes "free" inside the platform
   (native order execution, position management)
4. Signal file (YAML) remains the same regardless/
   of which platform consumes it

> **TODO FB (blocking):** What platform does the
> analyst actually trade on? This answer MIGHT determine
> which port to build first.

> **TODO:** For platforms with limited file I/O
> (e.g. Pine Script), how does the signal file get
> ingested? Options include manual input, webhook,
> or a bridge service that reads the YAML and
> pushes values to the platform via API.

### 11.4 Deployment

> **TBD** -- Local machine, cloud VPS, or
> dedicated trading server.

---

## 12. Glossary

| Term       | Definition                          |
|------------|-------------------------------------|
| QS         | Quantum Sage -- the overall system  |
| Trident    | The first mean-reversion strategy   |
|            | under the QS umbrella               |
| qs-signal- | QS module: the brain. Ingests       |
| engine     | signals, watches price, generates   |
|            | tradeable signals for Trident       |
| qs-trader  | QS module: the hands. Displays      |
|            | signals (manual) or executes them   |
|            | via broker API (auto)               |
| DVS        | Directional Volatility Score        |
| ES         | E-mini S&P 500 futures              |
| SPX        | S&P 500 cash index                  |
| Basis      | ES minus SPX spread (cost of carry) |
| IV Smile   | IV curve across option strikes      |
| MAX SELL   | Options-derived resistance level    |
| MAX BUY    | Options-derived support level       |
| CALL       | Heaviest call strike positioning    |
| CASH       | Cash reference price level          |
| SUPPORTO   | Options-derived support pivot       |
| RESISTENZA | Options-derived resistance pivot    |
| SKEW       | Tail risk premium index             |
| VWAP       | Volume Weighted Average Price --    |
|            | primary take-profit target          |
| Range 1    | Outer expected price boundaries     |
| Range 2    | Inner expected price boundaries     |
| Coast to   | Full move from MAX BUY/SELL to VWAP |
| Coast      |                                     |
| CFD        | Contract for Difference             |
| Signal     | YAML file -- QS's sole input        |
| File       |                                     |
| DVS Gate   | Hard rule: no trades if DVS > 75    |
| Three-Entry| Scaling into position at 3 levels   |
| Structure  | (32.5% / 35% / 32.5%)              |
| Breakeven  | Stop moved to entry after +25 pts   |

---

## 13. Appendices

### Appendix A: Signal File Example
See [qs_signal_2026-04-02_1006.yaml](research/sample-signal-files/qs_signal_2026-04-02_1006.yaml) for an
annotated example with inline comments showing
where each value originates on the analyst's
charts.

### Appendix B: DVS Thresholds

From the analyst's documentation:

- Below 50: Low vol, sideways, limited oscillation
- 50 to 75: Moderate, movements but no clear bias
- Above 75: **No trades allowed** (system rule)

DVS is combined with VWAP (directional
confirmation), volatility curves (compression /
expansion), and options volume (institutional
activity).

### Appendix C: Basis Conversion

- `cash_price = futures_price - basis`
- `futures_price = cash_price + basis`

Basis is positive in normal conditions. Changes
daily. Recent range: 40-75 points.

### Appendix D: Entry Allocation Parameters

| Parameter            | Value  |
|----------------------|--------|
| Entry 1 allocation   | 32.5%  |
| Entry 2 allocation   | 35.0%  |
| Entry 3 allocation   | 32.5%  |
| Entry 1 offset       | 0 pts  |
| Entry 2 offset       | 2 pts  |
| Entry 3 offset       | 0 pts  |
| Stop loss            | 40 pts |
| Breakeven trigger    | +25 pts|
| Hard profit exit     | +33 pts|
| Time exit            | 180 min|

These parameters are part of the Trident strategy configuration.

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

---

*End of document. This PRD is a living document and
will be updated as decisions are made and the system
evolves.*