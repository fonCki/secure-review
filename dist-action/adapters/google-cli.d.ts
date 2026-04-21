import type { CompleteInput, CompleteOutput, ModelAdapter } from './types.js';
/**
 * Shells out to `gemini -p` for local development. Local-dev only — the
 * factory refuses this adapter inside GitHub Actions runners.
 *
 * NOTE: `gemini` CLI does not currently expose token usage in its text
 * output. We estimate from char count (~4 chars/token) for bookkeeping.
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