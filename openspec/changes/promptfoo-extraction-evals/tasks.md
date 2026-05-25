## 1. Install and configure promptfoo

- [x] 1.1 Add `promptfoo` as a dev dependency in `trident/impl/nodejs/package.json` and run `npm install`
- [x] 1.2 Add `"eval": "promptfoo eval --config evals/promptfooconfig.yaml"` script to `package.json`
- [x] 1.3 Create `trident/impl/nodejs/evals/` directory structure: `fixtures/`, `provider.ts`, `promptfooconfig.yaml`, `dataset.yaml`

## 2. Golden dataset

- [x] 2.1 Add 2–3 representative IV Smile screenshot fixtures to `evals/fixtures/` (at minimum: one standard single-column chart, one two-column chart if available)
- [x] 2.2 Create `evals/dataset.yaml` with one entry per fixture: `filename`, `captured_on`, and expected values for `levels.max_buy_1`, `levels.max_buy_2`, `levels.max_sell_1`, `levels.max_sell_2`, `volatility.dvs`, `volatility.regime`

## 3. Custom provider

- [x] 3.1 Create `evals/provider.ts` — a promptfoo custom provider that reads the screenshot path from the test vars, calls `SignalExtractor.extract()`, and returns the full `ExtractionResult` JSON as the output
- [x] 3.2 Wire the provider to load `.env` (for `OPENAI_API_KEY`) and instantiate `LangChainExtractionProvider` the same way the web server does
- [x] 3.3 Handle the blocked/error cases: return a structured error response so promptfoo can mark the test case as failed with a reason

## 4. promptfoo configuration

- [x] 4.1 Write `evals/promptfooconfig.yaml` referencing the custom provider, the dataset, and one prompt entry (the provider handles the actual prompt — this can be a passthrough)
- [x] 4.2 Define assertions in the config (or per-test in `dataset.yaml`): level prices within ±5, `dvs` within ±1, `regime` exact match; explicitly skip `cash_last` and `basis`

## 5. Smoke test and docs

- [x] 5.1 Run `npm run eval` against the golden dataset end-to-end and verify all fixtures pass
- [x] 5.2 Add a short `evals/README.md` explaining how to run evals, how to add a new fixture, and how to update expected values when the prompt intentionally changes
