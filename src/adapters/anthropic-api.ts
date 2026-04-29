import Anthropic from '@anthropic-ai/sdk';
import { estimateCost } from '../util/cost.js';
import { withRetry } from '../util/retry.js';
import type { CompleteInput, CompleteOutput, ModelAdapter } from './types.js';

export class AnthropicAPIAdapter implements ModelAdapter {
  readonly provider = 'anthropic' as const;
  readonly mode = 'api' as const;
  private client: Anthropic;

  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(input: CompleteInput): Promise<CompleteOutput> {
    const started = Date.now();
    // For JSON mode, append an explicit reminder rather than using assistant
    // prefill — Claude 4 models do not support prefilling the assistant turn.
    const userContent = input.jsonMode
      ? `${input.user}\n\nReturn ONLY a JSON object. Your response must start with { and end with }. No prose, no markdown fences, no explanation.`
      : input.user;
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userContent }];
    const response = await withRetry(
      () =>
        this.client.messages.create({
          model: this.model,
          max_tokens: input.maxTokens ?? 16_000,
          system: input.system,
          messages,
        }),
      { label: `anthropic/${this.model}`, maxAttempts: 3, initialDelayMs: 1500 },
    );
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
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
