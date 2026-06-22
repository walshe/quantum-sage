## 1. DVS Gate Unblock on Resubmit

- [x] 1.1 In `TridentEngine.loadSignal()`, remove the early-return when `state === 'blocked'` so the DVS check runs again on every load
- [x] 1.2 If the new setup's DVS passes the gate check while state is `blocked`, reset state to `idle` before calling `setupTrade()`
- [x] 1.3 Ensure daily lock (`dailyLocked === true`) still prevents trading regardless of DVS
- [x] 1.4 Add/update unit tests for: resubmit-with-valid-DVS unblocks, resubmit-with-high-DVS stays blocked, daily lock unaffected

## 2. Engine Reset Endpoint

- [x] 2.1 Add `POST /engine/reset` to `src/web/server.ts` — calls `engine.reset()`, returns 409 if `in_trade`, returns `{ state: 'idle' }` on success
- [x] 2.2 Expose `engine.reset()` via the `startWebServer` options (add `onReset` callback or pass engine reference)
- [x] 2.3 Add test for the reset endpoint: success from blocked, success from watching, 409 from in_trade

## 3. Reset Button in UI

- [x] 3.1 Add "Reset engine" button to the action strip in `index.html` with an info tooltip
- [x] 3.2 Wire button in `app.js` to show a confirmation dialog, then `POST /engine/reset`
- [x] 3.3 On success: show a brief status message and update the status pane
- [x] 3.4 On 409: show error "Cannot reset while a trade is open"
- [x] 3.5 Add Italian translation for the button label and messages in `i18n.js`

## 4. AI Extraction — Opening Bell DVS

- [x] 4.1 Update `signalExtractionPrompt.ts` to instruct the model to prefer Opening Bell Range DVS when non-zero, falling back to Morning DVS
- [x] 4.2 Update prompt to prefer Opening Bell Range levels (Range 1/2 up/down) when non-zero, falling back to Morning levels
- [x] 4.3 Add the afternoon screenshot (Opening Bell DVS = 64.82, levels populated) to the golden dataset as a new eval fixture
- [x] 4.4 Run `npm run eval` and confirm extraction accuracy on the new fixture and existing fixtures

## 5. Documentation

- [x] 5.1 Update `PHASE_1_ANALYST_GUIDE.md` to explain: (a) Opening Bell DVS is preferred by AI extraction, (b) resubmitting with valid DVS unblocks the engine, (c) Reset engine button
- [x] 5.2 Update `developer-mental-notes.md`: note that DVS gate is now per-setup not per-day, and the reset endpoint exists
