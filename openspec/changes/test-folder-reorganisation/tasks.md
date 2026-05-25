## 1. Create subdirectory structure

- [x] 1.1 Create `tests/ai/`, `tests/signal/`, `tests/strategy/`, `tests/web/`, `tests/notifier/`, `tests/price-feed/`, `tests/config/`, `tests/observability/` directories

## 2. Move test files

- [x] 2.1 Move `aiSafety.test.ts`, `extractionGraph.test.ts`, `guardrail.test.ts`, `llmLogger.test.ts`, `outputValidator.test.ts`, `piiRedactor.test.ts` → `tests/ai/`
- [x] 2.2 Move `validator.test.ts`, `persistence.test.ts`, `signalLoaderScan.test.ts` → `tests/signal/`
- [x] 2.3 Move `calculator.test.ts` → `tests/strategy/`
- [x] 2.4 Move `webServer.test.ts`, `webSocketNotifier.test.ts` → `tests/web/`
- [x] 2.5 Move `multiNotifier.test.ts` → `tests/notifier/`
- [x] 2.6 Move `vwap.test.ts` → `tests/price-feed/`
- [x] 2.7 Move `configLoader.test.ts` → `tests/config/`
- [x] 2.8 Move `observability.test.ts` → `tests/observability/`

## 3. Fix import paths

- [x] 3.1 Update all `../src/` import paths to `../../src/` in the moved test files

## 4. Verify

- [x] 4.1 Run `npm test` and confirm all tests pass
- [x] 4.2 Add a note to `developer-mental-notes.md` that test files live under `tests/<module>/` mirroring `src/`
