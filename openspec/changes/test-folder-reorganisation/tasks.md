## 1. Create subdirectory structure

- [ ] 1.1 Create `tests/ai/`, `tests/signal/`, `tests/strategy/`, `tests/web/`, `tests/notifier/`, `tests/price-feed/`, `tests/config/`, `tests/observability/` directories

## 2. Move test files

- [ ] 2.1 Move `aiSafety.test.ts`, `extractionGraph.test.ts`, `guardrail.test.ts`, `llmLogger.test.ts`, `outputValidator.test.ts`, `piiRedactor.test.ts` → `tests/ai/`
- [ ] 2.2 Move `validator.test.ts`, `persistence.test.ts`, `signalLoaderScan.test.ts` → `tests/signal/`
- [ ] 2.3 Move `calculator.test.ts` → `tests/strategy/`
- [ ] 2.4 Move `webServer.test.ts`, `webSocketNotifier.test.ts` → `tests/web/`
- [ ] 2.5 Move `multiNotifier.test.ts` → `tests/notifier/`
- [ ] 2.6 Move `vwap.test.ts` → `tests/price-feed/`
- [ ] 2.7 Move `configLoader.test.ts` → `tests/config/`
- [ ] 2.8 Move `observability.test.ts` → `tests/observability/`

## 3. Fix import paths

- [ ] 3.1 Update all `../src/` import paths to `../../src/` in the moved test files

## 4. Verify

- [ ] 4.1 Run `npm test` and confirm all tests pass
- [ ] 4.2 Add a note to `developer-mental-notes.md` that test files live under `tests/<module>/` mirroring `src/`
