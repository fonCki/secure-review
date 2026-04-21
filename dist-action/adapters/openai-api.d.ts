import type { CompleteInput, CompleteOutput, ModelAdapter } from './types.js';
export declare class OpenAIAPIAdapter implements ModelAdapter {
    readonly model: string;
    readonly provider: "openai";
    readonly mode: "api";
    private client;
    constructor(model: string, apiKey: string);
    complete(input: CompleteInput): Promise<CompleteOutput>;
}
//# sourceMappingURL=openai-api.d.ts.map