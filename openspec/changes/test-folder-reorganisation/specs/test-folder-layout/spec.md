## ADDED Requirements

### Requirement: Test files are organised into module subfolders
Test files under `trident/impl/nodejs/tests/` SHALL be organised into subdirectories that mirror the module structure of `trident/impl/nodejs/src/`, using the same folder names.

#### Scenario: AI module tests are in tests/ai/
- **WHEN** a developer navigates to `tests/ai/`
- **THEN** they find all test files for code under `src/ai/` (aiSafety, extractionGraph, guardrail, llmLogger, outputValidator, piiRedactor)

#### Scenario: Signal module tests are in tests/signal/
- **WHEN** a developer navigates to `tests/signal/`
- **THEN** they find all test files for code under `src/signal/` (validator, persistence, signalLoaderScan)

#### Scenario: Strategy module tests are in tests/strategy/
- **WHEN** a developer navigates to `tests/strategy/`
- **THEN** they find all test files for code under `src/strategy/` (calculator)

#### Scenario: Web module tests are in tests/web/
- **WHEN** a developer navigates to `tests/web/`
- **THEN** they find all test files for code under `src/web/` (webServer, webSocketNotifier)

#### Scenario: Notifier module tests are in tests/notifier/
- **WHEN** a developer navigates to `tests/notifier/`
- **THEN** they find all test files for code under `src/notifier/` (multiNotifier)

#### Scenario: Price-feed module tests are in tests/price-feed/
- **WHEN** a developer navigates to `tests/price-feed/`
- **THEN** they find all test files for code under `src/price-feed/` (vwap)

#### Scenario: Config module tests are in tests/config/
- **WHEN** a developer navigates to `tests/config/`
- **THEN** they find all test files for code under `src/config/` (configLoader)

#### Scenario: Observability module tests are in tests/observability/
- **WHEN** a developer navigates to `tests/observability/`
- **THEN** they find all test files for code under `src/observability/` (observability)

### Requirement: All tests continue to pass after reorganisation
The test suite SHALL pass without modification to test logic after files are moved to their new locations.

#### Scenario: npm test succeeds after reorganisation
- **WHEN** `npm test` is run from `trident/impl/nodejs/` after all files have been moved
- **THEN** all tests pass and none are skipped due to missing imports

### Requirement: Vitest discovers all tests without explicit configuration
Vitest SHALL discover all test files using its default glob pattern (`**/*.test.ts`) without requiring a `vitest.config.ts` or changes to `package.json`.

#### Scenario: No Vitest config is needed
- **WHEN** test files are placed in nested subdirectories under `tests/`
- **THEN** Vitest finds and runs all of them via its default recursive glob
