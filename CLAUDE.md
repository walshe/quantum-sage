# Trident / Quantum Sage — Claude Code Instructions

## Key documents

| Document | Path |
|---|---|
| Architecture | `ARCHITECTURE.md` |
| PRD | `trident/docs/PRD.md` |
| Developer mental notes | `trident/impl/nodejs/developer-mental-notes.md` |
| Analyst guide (Phase 1) | `trident/docs/PHASE_1_ANALYST_GUIDE.md` |
| FAQ | `trident/impl/nodejs/FAQ.md` |

## Distribution

The app runs in Docker. FB (the analyst) pulls a pre-built image from `ghcr.io/walshe/trident:latest` and runs it with `docker compose up`. He only needs `docker-compose.yml`, `.env`, and `config.yaml` — no source code.

- Dev compose setup: `trident/impl/nodejs/docker-compose.yml` + `docker-compose.override.yml` (builds locally)
- Image is published automatically by `.github/workflows/docker-publish.yml` on pushes to `main` that touch source files
- FB's operator guide: `trident/impl/nodejs/RUNNING.md`

## Before starting any implementation

Read `trident/impl/nodejs/developer-mental-notes.md` before writing code. It contains non-obvious constraints, past decisions, and known gotchas that are not visible from the code alone. Skipping this risks repeating mistakes or violating invariants the team has already resolved.

## After every code change

1. **Run the test suite** from `trident/impl/nodejs/`:
   ```
   npm test
   ```
   Fix any failures before reporting the task done. Do not mark work complete if tests are red.

2. **Update the architecture doc** (`ARCHITECTURE.md`) if the change adds or removes a major component, introduces a new integration point, changes the data flow, or advances the phase (e.g. Phase 2 auto-execution lands). Do not update it for implementation details — that belongs in the mental notes.

3. **Update the PRD** (`trident/docs/PRD.md`) if the change affects system behaviour, data contracts, level mappings, engine state transitions, or any other detail a future reader would need to understand how the system works.

4. **Update developer mental notes** (`trident/impl/nodejs/developer-mental-notes.md`) if the change reveals something non-obvious — a subtle invariant, a workaround, a constraint that isn't obvious from the code.

5. **Update the analyst guide** (`trident/impl/nodejs/PHASE_1_ANALYST_GUIDE.md`) if the change affects anything the analyst (FB) interacts with: form fields, tooltips, workflow steps, or submission behaviour.

6. **Update the FAQ** (`trident/impl/nodejs/FAQ.md`) if the change answers a question that is likely to come up again, or invalidates an existing answer.

Only update a document when the change is genuinely relevant to it — do not pad documents with trivial entries.
