import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

import { ClaudeExtractionProvider } from '../src/ai/providers/ClaudeExtractionProvider.js';
import { SignalExtractor, ExtractionBlockedError } from '../src/ai/signalExtractor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  throw new Error('ANTHROPIC_API_KEY is not set — add it to trident/impl/nodejs/.env before running evals');
}

const visionProvider = new ClaudeExtractionProvider({ apiKey });
const extractor = new SignalExtractor(visionProvider);

export default class SignalExtractorProvider {
  id(): string {
    return 'signal-extractor';
  }

  async callApi(prompt: string, context: { vars: Record<string, string> }) {
    const fixture = context.vars['fixture'];
    if (!fixture) {
      return { output: JSON.stringify({ error: 'missing_var', reason: 'test var "fixture" is required' }) };
    }

    const imagePath = resolve(__dirname, 'fixtures', fixture);
    const bytes = readFileSync(imagePath);
    const mimeType = fixture.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

    try {
      const result = await extractor.extract([{ bytes, mimeType, filename: fixture }]);
      return { output: JSON.stringify(result) };
    } catch (err) {
      if (err instanceof ExtractionBlockedError) {
        return {
          output: JSON.stringify({ error: 'guardrail_blocked', reason: err.message }),
        };
      }
      return {
        output: JSON.stringify({ error: 'extraction_failed', reason: String(err) }),
      };
    }
  }
}
