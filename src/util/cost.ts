import type { Provider } from '../config/schema.js';

/**
 * Per-million-token USD prices. Update as vendors publish changes.
 * Sources:
 *   Anthropic: https://www.anthropic.com/pricing
 *   OpenAI:    https://openai.com/api/pricing
 *   Google:    https://ai.google.dev/pricing
 */
interface Price {
  inputPerMtok: number;
  outputPerMtok: number;
}

const PRICES: Record<string, Price> = {
  // Anthropic
  'claude-sonnet-4-6': { inputPerMtok: 3, outputPerMtok: 15 },
  'claude-sonnet-4-5': { inputPerMtok: 3, outputPerMtok: 15 },
  'claude-opus-4-7': { inputPerMtok: 15, outputPerMtok: 75 },
  'claude-haiku-4-5': { inputPerMtok: 0.8, outputPerMtok: 4 },

  // OpenAI
  'gpt-5-codex': { inputPerMtok: 5, outputPerMtok: 15 },
  'gpt-5': { inputPerMtok: 5, outputPerMtok: 15 },
  'gpt-4o': { inputPerMtok: 2.5, outputPerMtok: 10 },
  'gpt-4o-mini': { inputPerMtok: 0.15, outputPerMtok: 0.6 },

  // Google
  'gemini-2.5-pro': { inputPerMtok: 1.25, outputPerMtok: 5 },
  'gemini-2.5-flash': { inputPerMtok: 0.075, outputPerMtok: 0.3 },
  'gemini-2.5-flash-lite': { inputPerMtok: 0.075, outputPerMtok: 0.3 },
  'gemini-2.0-flash': { inputPerMtok: 0.1, outputPerMtok: 0.4 },
};

const FALLBACK: Price = { inputPerMtok: 5, outputPerMtok: 15 };

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model] ?? FALLBACK;
  return (inputTokens / 1_000_000) * price.inputPerMtok + (outputTokens / 1_000_000) * price.outputPerMtok;
}

export function knownModel(model: string): boolean {
  return model in PRICES;
}

export function modelsByProvider(provider: Provider): string[] {
  return Object.keys(PRICES).filter((m) => {
    if (provider === 'anthropic') return m.startsWith('claude-');
    if (provider === 'openai') return m.startsWith('gpt-');
    if (provider === 'google') return m.startsWith('gemini-');
    return false;
  });
}
