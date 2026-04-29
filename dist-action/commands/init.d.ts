export interface InitOptions {
    force?: boolean;
    yes?: boolean;
}
export type ProviderName = 'anthropic' | 'openai' | 'google';
export type GithubActionMode = 'active' | 'example' | 'skip';
export interface InitAnswers {
    useAnthropic: boolean;
    useOpenAI: boolean;
    useGoogle: boolean;
    writerProvider: ProviderName;
    writerModel: string;
    maxIterations: number;
    enableSast: boolean;
    writeKeys: boolean;
    githubAction: GithubActionMode;
    anthropicKey?: string;
    openaiKey?: string;
    googleKey?: string;
}
export declare const WRITER_MODEL_DEFAULTS: Record<ProviderName, string>;
export declare const READER_MODEL_DEFAULTS: Record<ProviderName, string>;
export declare function runInit(opts?: InitOptions): Promise<void>;
export declare function generateConfig(a: InitAnswers, skillsBase?: string): string;
/**
 * Render the GitHub Actions workflow for this project. Only includes env
 * vars for providers the user actually enabled, so the user only needs to
 * set up GitHub secrets for the keys they actually use.
 *
 * The `npm ci` step is critical: without it, the action runs in a fresh
 * checkout where `node_modules/secure-review/skills/...` (the path written
 * into the user's .secure-review.yml) doesn't exist and skill loading fails.
 */
export declare function generateWorkflow(a: InitAnswers): string;
export declare const SECURE_REVIEW_ENV_MARKER = "# === secure-review ===";
export declare function generateEnv(a: InitAnswers): string;
//# sourceMappingURL=init.d.ts.map