## Why

The IV Smile chart has two DVS columns — Morning and Opening Bell Range. Today the morning DVS (76.53) was too high and blocked the entire session, even though the Opening Bell DVS (64.82) was valid for trading. The AI extractor was reading the wrong column, and the engine has no way to unblock once a DVS gate fires — even if a later setup has a valid DVS.

## What Changes

- **AI extraction prompt**: Extract the **Opening Bell Range DVS** (right column) when non-zero, falling back to Morning DVS only when Opening Bell is absent or zero. This matches how the analyst actually uses the chart — the Opening Bell Range is the operative trading window.
- **Engine DVS gate**: When a new setup is submitted (any `update_seq`) and the resolved DVS is below the gate threshold, the engine unblocks and transitions to `watching`. The DVS gate becomes per-setup, not per-day.
- **UI reset button**: Add a "Reset engine" button to allow the analyst to manually clear the blocked/closed state back to idle (calls `POST /engine/reset`). Guarded against use while `in_trade`.

## Capabilities

### New Capabilities
- `engine-reset`: A `POST /engine/reset` endpoint and UI button that resets engine state to idle, clearing the daily block and snapshot. Blocked while `in_trade`.

### Modified Capabilities
- `dvs-gate`: DVS gate now re-evaluates on every new setup load. If the incoming setup's DVS is below the gate, the engine unblocks. The gate is no longer a permanent per-day lock.
- `ai-dvs-extraction`: AI extraction reads Opening Bell Range DVS (right column) when non-zero; falls back to Morning DVS when Opening Bell column is empty or zero.

## Impact

- `src/strategy/TridentEngine.ts` — `loadSignal()` must clear the blocked state if DVS passes on a subsequent load
- `src/web/server.ts` — new `POST /engine/reset` endpoint
- `src/web/public/app.js` — new Reset button in the UI action strip
- `src/ai/prompts/signalExtractionPrompt.ts` — update prompt to prefer Opening Bell DVS
- `src/signal/types.ts` — no schema change needed; DVS field is already a number
- Evals golden dataset — update any fixture that uses Morning DVS when Opening Bell is available
