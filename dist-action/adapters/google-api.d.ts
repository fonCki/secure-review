import type { CompleteInput, CompleteOutput, ModelAdapter } from './types.js';
export declare class GoogleAPIAdapter implements ModelAdapter {
    readonly model: string;
    readonly provider: "google";
    readonly mode: "api";
    private client;
    constructor(model: string, apiKey: string);
    complete(input: CompleteInput): Promise<CompleteOutput>;
}
//# sourceMappingURL=google-api.d.ts.map