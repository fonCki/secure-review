import OpenAI from 'openai';
import { estimateCost } from '../util/cost.js';
import { withRetry } from '../util/retry.js';
import type { CompleteInput, CompleteOutput, ModelAdapter } from './types.js';

export class OpenAIAPIAdapter implements ModelAdapter {
  readonly provider = 'openai' as const;
  readonly mode = 'api' as const;
  private client: OpenAI;

  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(input: CompleteInput): Promise<CompleteOutput> {
    const started = Date.now();
    const response = await withRetry(
      () =>
        this.client.chat.completions.create({
          model: this.model,
          max_completion_tokens: input.maxTokens ?? 16_000,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
          ...(input.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
        }),
      { label: `openai/${this.model}`, maxAttempts: 3, initialDelayMs: 1500 },
    );
    const text = response.choices[0]?.message?.content ?? '';
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    return {
      text,
      usage: {
        inputTokens,
        outputTokens,
        costUSD: estimateCost(this.model, inputTokens, outputTokens),
      },
      durationMs: Date.now() - started,
      raw: response,
    };
  }
}
