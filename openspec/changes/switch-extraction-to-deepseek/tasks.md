## 1. Update LangChainExtractionProvider

- [x] 1.1 Add optional `name` field to `LangChainExtractionProviderOpts` and set `this.name` from it (default `'openai'`)

## 2. Wire DeepSeek in the provider factory

- [x] 2.1 Add `deepseek` case to `buildVisionProvider()` in `src/ai/providers/index.ts`
- [x] 2.2 Read `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` (default `deepseek-chat`), `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com/v1`)
- [x] 2.3 Instantiate `LangChainExtractionProvider` with `name: 'deepseek'` and the DeepSeek opts

## 3. Documentation

- [x] 3.1 Update `README.md` env var table: add `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, update `TRIDENT_AI_PROVIDER` description
- [x] 3.2 Update `RUNNING.md` with DeepSeek setup instructions

## 4. Verify

- [x] 4.1 Run `npm test` and confirm all tests pass
