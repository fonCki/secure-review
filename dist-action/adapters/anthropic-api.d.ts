import type { CompleteInput, CompleteOutput, ModelAdapter } from './types.js';
export declare class AnthropicAPIAdapter implements ModelAdapter {
    readonly model: string;
    readonly provider: "anthropic";
    readonly mode: "api";
    private client;
    constructor(model: string, apiKey: string);
    complete(input: CompleteInput): Promise<CompleteOutput>;
}
//# sourceMappingURL=anthropic-api.d.ts.map