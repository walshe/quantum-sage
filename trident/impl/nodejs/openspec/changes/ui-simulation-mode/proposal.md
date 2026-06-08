# Proposal: UI Simulation Mode

## Why

The Trident UI has never been seen working through a complete trade sequence — watching → Entry 1 → Entry 2 → Entry 3 → in-trade — without relying on live market prices and a real broker account. This makes it impossible to review and validate the UI layout and information flow before showing it to the analyst (FB).

## What Changes

- Add a `/simulate` developer endpoint (or npm script) that drives the engine through a scripted trade scenario at accelerated speed
- Scenario covers the full happy path: setup loaded → watching both sides → Entry 1 long → Entry 2 long → Entry 3 long → position open with all 3 fills → breakeven triggered → position closed at VWAP
- UI remains completely unchanged — the simulation fires real engine events through the normal notifier chain, so the live log, status panel, open position section, and account chip all respond exactly as they would in production
- Simulation uses synthetic prices (no cTrader connection required)
- Configurable delay between steps (default 2 seconds) so a human can follow along

## Capabilities

### New Capabilities

- **simulation-runner**: A standalone script (`scripts/simulate-trade.ts`) that injects synthetic price ticks and YAML setup files into the running engine to walk through a full trade scenario step-by-step

## Out of Scope

- No changes to engine logic or UI components — this is purely a dev/demo tool
- No persistent simulation state — each run starts fresh
- Auto-execution is disabled during simulation (advisory mode only)
