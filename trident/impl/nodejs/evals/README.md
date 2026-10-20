# IV Smile extraction evals

Golden-dataset evaluation of the AI extraction pipeline using [promptfoo](https://promptfoo.dev/).

## Run the eval suite

```sh
cd trident/impl/nodejs
npm run eval
```

Uses the app's provider selection (`TRIDENT_AI_PROVIDER`, default `anthropic`) and needs
that provider's API key in `trident/impl/nodejs/.env`. With `TRIDENT_AI_PROVIDER=openrouter`
you can score any model by setting `OPENROUTER_MODEL`. Each run makes real API calls
(~1 call per active fixture). Not run in CI — execute deliberately.

## Add a new fixture

1. Drop the screenshot into `evals/fixtures/` (e.g. `iv_smile_05.jpg`).
2. Add an entry to `evals/dataset.yaml` with the expected values and `captured_on`.
3. Add a test case to `evals/promptfooconfig.yaml` under `tests:`, referencing the new
   file via `vars.fixture` and filling in the assertions.

## Update expected values

When the prompt or model changes intentionally and the extraction output shifts:

1. Run `npm run eval` to see which assertions fail and by how much.
2. Update `dataset.yaml` with the new expected values.
3. Update the corresponding assertions in `promptfooconfig.yaml`.
4. Commit both files together with a message describing why the baseline changed.

## Fixture key mapping

`dataset.yaml` uses domain-model keys; the extraction result uses the internal schema:

| dataset.yaml key | ExtractionResult path           | Chart label        |
|------------------|---------------------------------|--------------------|
| `buy_outer`      | `signal.levels.max_buy_1`       | BUY OUTER          |
| `buy_inner`      | `signal.levels.max_buy_2`       | BUY INNER          |
| `sell_inner`     | `signal.levels.max_sell_2`      | SELL INNER         |
| `sell_outer`     | `signal.levels.max_sell_1`      | SELL OUTER         |
| `dvs`            | `signal.volatility.dvs`         | DVS box            |
| `regime`         | `signal.volatility.regime`      | compressed/normal/elevated/extreme |

## Assertion tolerances

| Field        | Tolerance | Rationale                               |
|--------------|-----------|-----------------------------------------|
| Level prices | ±5 points | OCR variance across chart renders       |
| DVS          | ±1        | Read from labeled box, not inferred     |
| Regime       | exact     | Enum; wrong regime is a real regression |
| cash_last    | (none)    | Deliberately null — not asserted        |
| basis        | (none)    | Deliberately null — not asserted        |
