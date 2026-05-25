## Why

The AI extraction pipeline (`guardrail → llm-call → validate → normalise`) has no golden-dataset tests — existing tests mock the LLM entirely, so a prompt regression or model swap goes undetected until FB notices bad pre-fills in production. promptfoo provides a local, open-source way to run real extractions against a fixed set of IV Smile screenshots and assert on the structured output, making prompt changes safe to iterate on.

## What Changes

- Install and configure `promptfoo` as a dev dependency
- Add a small golden dataset of real IV Smile screenshots with labelled expected outputs
- Write a custom promptfoo provider that calls the existing `SignalExtractor` (reusing all safety/validation layers)
- Define evaluator assertions for the fields that matter most: `levels.*`, `volatility.dvs`, `volatility.regime`
- Add an `npm run eval` script that runs the suite without touching the normal `npm test` path (avoids real API calls in CI)

## Capabilities

### New Capabilities

- `extraction-eval-suite`: promptfoo configuration, custom provider, and golden dataset that evaluates the IV Smile extraction prompt against real screenshots

### Modified Capabilities

<!-- none — no existing spec-level behaviour changes -->

## Impact

- **New dev dependency**: `promptfoo` (CLI + SDK)
- **New files**: `evals/` directory with promptfoo config, golden dataset, and custom provider script
- **No production code changes**: provider wires into existing `SignalExtractor` — extraction pipeline is unchanged
- **API cost**: each `npm run eval` run makes real OpenAI calls (~1 call per screenshot in the dataset); not run in CI by default
