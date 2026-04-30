import type { VisionProvider } from '../types.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { getLogger } from '../../logger.js';

const log = getLogger('ai/providers');

/**
 * Build the vision provider from environment configuration.
 *
 * Selection order:
 *   1. `TRIDENT_AI_PROVIDER` env var ("openai" today, future: "anthropic" etc).
 *   2. Default = "openai".
 *
 * Returns `null` if the chosen provider is not configured (e.g. no API key).
 * Caller should treat null as "AI unavailable, surface a friendly UI message
 * and let the analyst fill the form manually."
 *
 * AI is OPTIONAL — never throws so an engine startup is never blocked by
 * a missing key. The intensity of the disable-log depends on whether the
 * operator explicitly opted into a provider:
 *   - explicit `TRIDENT_AI_PROVIDER=openai` + missing key → `error`
 *     (clear misconfiguration, operator wanted AI but didn't provide creds)
 *   - implicit default + missing key                     → `info`
 *     (operator never asked for AI; not a problem)
 */
export function buildVisionProvider(): VisionProvider | null {
  const explicit = process.env.TRIDENT_AI_PROVIDER != null;
  const choice = (process.env.TRIDENT_AI_PROVIDER ?? 'openai').toLowerCase();
  switch (choice) {
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        if (explicit) {
          log.error('TRIDENT_AI_PROVIDER=openai but OPENAI_API_KEY is missing — AI extraction disabled');
        } else {
          log.info('AI extraction disabled (no OPENAI_API_KEY); Import will save screenshots only');
        }
        return null;
      }
      return new OpenAIProvider({
        apiKey,
        model: process.env.OPENAI_MODEL,
        baseURL: process.env.OPENAI_BASE_URL,
      });
    }
    // Future: anthropic, gemini, etc.
    default:
      log.error('Unknown TRIDENT_AI_PROVIDER — AI extraction disabled', { choice });
      return null;
  }
}
