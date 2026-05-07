# Trident / Quantum Sage — Claude Code Instructions

## Key documents

| Document | Path |
|---|---|
| PRD | `trident/docs/PRD.md` |
| Developer mental notes | `trident/impl/nodejs/developer-mental-notes.md` |
| Analyst guide (Phase 1) | `trident/docs/PHASE_1_ANALYST_GUIDE.md` |
| FAQ | `trident/impl/nodejs/FAQ.md` |

## After every code change

1. **Run the test suite** from `trident/impl/nodejs/`:
   ```
   npm test
   ```
   Fix any failures before reporting the task done. Do not mark work complete if tests are red.

2. **Update the PRD** (`trident/docs/PRD.md`) if the change affects system behaviour, data contracts, level mappings, engine state transitions, or any other detail a future reader would need to understand how the system works.

3. **Update developer mental notes** (`trident/impl/nodejs/developer-mental-notes.md`) if the change reveals something non-obvious — a subtle invariant, a workaround, a constraint that isn't obvious from the code.

4. **Update the analyst guide** (`trident/impl/nodejs/PHASE_1_ANALYST_GUIDE.md`) if the change affects anything the analyst (FB) interacts with: form fields, tooltips, workflow steps, or submission behaviour.

5. **Update the FAQ** (`trident/impl/nodejs/FAQ.md`) if the change answers a question that is likely to come up again, or invalidates an existing answer.

Only update a document when the change is genuinely relevant to it — do not pad documents with trivial entries.
