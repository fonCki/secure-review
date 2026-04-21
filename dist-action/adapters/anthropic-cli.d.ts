import type { CompleteInput, CompleteOutput, ModelAdapter } from './types.js';
/**
 * Shells out to `claude -p` for local development. Uses Claude CLI's
 * --output-format stream-json to capture usage data. Local-dev only:
 * the factory refuses this adapter inside GitHub Actions runners.
 */
export declare class AnthropicCLIAdapter implements ModelAdapter {
    readonly model: string;
    private readonly binary;
    readonly provider: "anthropic";
    readonly mode: "cli";
    constructor(model: string, binary?: string);
    complete(input: CompleteInput): Promise<CompleteOutput>;
}
//# sourceMappingURL=anthropic-cli.d.ts.map