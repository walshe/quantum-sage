## Why

All test files in `trident/impl/nodejs/tests/` currently live at a single flat level, making it harder to navigate and understand which module a test belongs to. Organising them into subfolders that mirror the `src/` module structure brings test discoverability in line with the source layout.

## What Changes

- Move test files into subdirectories under `tests/` matching their source module:
  - `tests/ai/` — `aiSafety.test.ts`, `extractionGraph.test.ts`, `guardrail.test.ts`, `llmLogger.test.ts`, `outputValidator.test.ts`, `piiRedactor.test.ts`
  - `tests/signal/` — `validator.test.ts`, `persistence.test.ts`, `signalLoaderScan.test.ts`
  - `tests/strategy/` — `calculator.test.ts`
  - `tests/web/` — `webServer.test.ts`, `webSocketNotifier.test.ts`
  - `tests/notifier/` — `multiNotifier.test.ts`
  - `tests/price-feed/` — `vwap.test.ts`
  - `tests/config/` — `configLoader.test.ts`
  - `tests/observability/` — `observability.test.ts`
- Update any import paths inside tests if needed (most use `../src/...` which will need an extra `../`)
- Update Vitest config or `tsconfig` if they reference specific test paths

## Capabilities

### New Capabilities

- `test-folder-layout`: Test files are organised into subdirectories mirroring the `src/` module structure

### Modified Capabilities

## Impact

- `trident/impl/nodejs/tests/` — all test files relocated
- `trident/impl/nodejs/tsconfig.json` — `exclude` already covers `tests/**`; no change needed
- `trident/impl/nodejs/vitest.config.ts` (or equivalent) — may need glob update if path is hard-coded
- Relative import paths inside test files — need one extra `../` level
