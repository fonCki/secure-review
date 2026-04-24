import { GoogleGenerativeAI } from '@google/generative-ai';
import { estimateCost } from '../util/cost.js';
import type { CompleteInput, CompleteOutput, ModelAdapter } from './types.js';

export class GoogleAPIAdapter implements ModelAdapter {
  readonly provider = 'google' as const;
  readonly mode = 'api' as const;
  private client: GoogleGenerativeAI;

  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async complete(input: CompleteInput): Promise<CompleteOutput> {
    const started = Date.now();
    const requestOptions = process.env.GOOGLE_BASE_URL
      ? { baseUrl: process.env.GOOGLE_BASE_URL }
      : undefined;
    const gen = this.client.getGenerativeModel(
      {
        model: this.model,
        systemInstruction: input.system,
        generationConfig: {
          maxOutputTokens: input.maxTokens ?? 16_000,
          ...(input.jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      },
      requestOptions,
    );
    const response = await gen.generateContent(input.user);
    const text = response.response.text();
    const usageMeta = response.response.usageMetadata;
    const inputTokens = usageMeta?.promptTokenCount ?? 0;
    const outputTokens = usageMeta?.candidatesTokenCount ?? 0;
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
