import type { CompleteInput, CompleteOutput, ModelAdapter } from './types.js';
/**
 * Shells out to `gemini -p <prompt>` for local development. The gemini CLI
 * takes the prompt as the argument to -p (not stdin). Loading noise goes
 * to stderr; the model response goes to stdout.
 *
 * Local-dev only — the factory refuses this adapter inside GitHub Actions.
 */
export declare class GoogleCLIAdapter implements ModelAdapter {
    readonly model: string;
    private readonly binary;
    readonly provider: "google";
    readonly mode: "cli";
    constructor(model: string, binary?: string);
    complete(input: CompleteInput): Promise<CompleteOutput>;
}
//# sourceMappingURL=google-cli.d.ts.map