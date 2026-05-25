## Context

`trident/impl/nodejs/tests/` holds 16 test files all at a single flat level. The source tree under `src/` is organised into modules (`ai/`, `signal/`, `strategy/`, `web/`, `notifier/`, `price-feed/`, `config/`, `observability/`). As the test suite grows, flat layout makes it harder to navigate to the tests for a specific module. This is a pure file-system reorganisation — no test logic changes.

## Goals / Non-Goals

**Goals:**
- Move every test file into a subfolder that matches its `src/` counterpart
- Keep all tests passing without changing any test logic
- Ensure Vitest still discovers all tests automatically after the move

**Non-Goals:**
- Changing test content, coverage, or assertions
- Adding new tests as part of this change
- Reorganising `evals/` or any non-Vitest test infrastructure

## Decisions

**Decision: Mirror `src/` module names exactly**
Using identical folder names (`ai/`, `signal/`, `strategy/`, `web/`, `notifier/`, `price-feed/`, `config/`, `observability/`) makes the correspondence obvious. Alternative (grouping by concern e.g. `unit/`, `integration/`) was rejected because Vitest already handles both; module mirroring is more useful for navigation.

**Decision: Rely on Vitest's default glob (`**/*.test.ts`)**
No `vitest.config.ts` exists; Vitest discovers tests automatically. After moving files, discovery will continue to work. No configuration changes are needed. Alternative (explicitly listing test dirs) would add unnecessary maintenance overhead.

**Decision: Update relative imports inside test files**
Most tests import from `../src/...`. After moving one level deeper the path becomes `../../src/...`. This is mechanical and can be done with a simple find-and-replace per file. No test logic changes.

## Risks / Trade-offs

[Import path breakage] → Each file must have its `../src/` imports updated to `../../src/`. Vitest will fail immediately if a path is wrong, so any missed file is caught at test-run time rather than silently.

[Future test files added to the wrong place] → Developers must know the convention. A note in developer-mental-notes.md removes this risk.

## Migration Plan

1. Create subdirectories under `tests/`
2. Move each test file to its new location
3. Update `../src/` → `../../src/` import paths inside the moved files
4. Run `npm test` to confirm all tests pass
5. No rollback complexity — git history preserves the pre-move state
