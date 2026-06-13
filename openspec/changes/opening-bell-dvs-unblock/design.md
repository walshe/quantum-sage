## Context

The IV Smile chart has two side-by-side panels: **Morning** (left, green background) and **Opening Bell Range** (right, highlighted). Each has its own DVS value. Until now, the AI extractor read the Morning DVS because that was the only column in early builds. The Opening Bell Range column was added later and the prompt was never updated to prefer it.

The DVS gate in `TridentEngine.loadSignal()` fires once and sets state to `blocked` with no recovery path — the engine stays blocked until manually reset. This was intentional early on but is now a pain point: the analyst can recalibrate mid-session with a valid Opening Bell DVS and should be able to resume trading without a manual restart.

## Goals / Non-Goals

**Goals:**
- AI extraction reads Opening Bell DVS when non-zero; falls back to Morning DVS
- Engine unblocks on a fresh setup load if new DVS is below the gate
- `POST /engine/reset` endpoint and UI button for manual reset
- No breaking change to the signal YAML schema or API

**Non-Goals:**
- Separate `dvs_opening_bell` field in the schema — one `volatility.dvs` field is enough; the analyst picks the operative value before submitting
- Automatic unblocking without a new setup submission — the analyst must consciously submit
- DVS gate removal or threshold change

## Decisions

**1. Single `volatility.dvs` field — no new field**
The form already has one DVS field. The fix is in the AI extraction layer: read Opening Bell DVS into the existing `volatility.dvs` field. The analyst sees the pre-filled value and can correct it before submitting. No schema migration needed.

Alternative considered: add `dvs_opening_bell` as a separate field and let the engine pick the lower. Rejected — adds complexity to validation, YAML schema, and the form; the analyst is already reviewing the pre-fill.

**2. DVS gate re-evaluates on every `loadSignal`**
Change `TridentEngine.loadSignal()`: if state is `blocked` AND the new setup's DVS is below the gate, clear `blocked` and call `setupTrade()` as normal. The block is now "blocked until a valid setup arrives" not "blocked for the day".

Alternative considered: only unblock on `update_seq === 1` (New Setup). Rejected — an Update During Session with valid DVS should also unblock; the analyst shouldn't have to use New Setup just to clear a block.

**3. `POST /engine/reset` — hard reset, guarded against `in_trade`**
Calls `engine.reset()` which already exists in the codebase (used in tests). Returns 409 if state is `in_trade`. UI button visible in the action strip, labelled "Reset engine", with a confirmation step to avoid accidental clicks.

Alternative considered: reset via the existing signal submission. Too implicit — the analyst might not realise a New Setup resets state. An explicit button is clearer.

**4. AI prompt change — prefer Opening Bell, fallback to Morning**
Update `signalExtractionPrompt.ts` to instruct the model: extract DVS from the Opening Bell Range column when it is non-zero; use Morning column only when Opening Bell is absent or shows 0.00. Add to the golden dataset a fixture of the afternoon screenshot (Opening Bell DVS = 64.82).

## Risks / Trade-offs

- **Unblock on bad data** → If the AI misreads the Opening Bell DVS as low when it's actually high, the engine could unblock inappropriately. Mitigation: the analyst reviews the pre-filled DVS value before submitting; the validator range-checks DVS (0–200).
- **Confusing UX if DVS gate fires mid-session** → The analyst submits, gets blocked, then submits again with lower DVS and unblocks. This flow is new and not documented. Mitigation: update the UI log message and the PHASE_1_ANALYST_GUIDE to explain the new behavior.
- **Reset button misuse** → Analyst clicks Reset while a position is conceptually open at the broker but the engine shows `watching`. Mitigation: the reset is guarded against `in_trade` only; `watching` can be reset (no broker position). Document this in the guide.

## Migration Plan

No data migration needed. The YAML schema is unchanged. Deploy via the normal Docker image publish on merge to main. Existing setups already in `setups/` are unaffected — they'll be re-evaluated with the new DVS logic on the next setup load.
