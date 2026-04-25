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
    // JSON-mode trick: Anthropic doesn't have a native "structured output" flag,
    // but we can prefill the assistant turn with `{` so the model has no choice
    // but to continue inside a JSON object. This drops the "Sure, here's your
    // fix..." prose almost entirely. We re-prepend the `{` to the response text
    // so downstream parsers see a complete JSON object.
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: input.user }];
    if (input.jsonMode) {
      messages.push({ role: 'assistant', content: '{' });
    }
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
    let text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (input.jsonMode) {
      // The `{` we prefilled is not in `text` (Anthropic returns only what the
      // model generated AFTER the prefill). Glue it back on for the parser.
      text = '{' + text;
    }
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
