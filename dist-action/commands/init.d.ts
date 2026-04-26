export interface InitOptions {
    force?: boolean;
    yes?: boolean;
}
export type ProviderName = 'anthropic' | 'openai' | 'google';
export interface InitAnswers {
    useAnthropic: boolean;
    useOpenAI: boolean;
    useGoogle: boolean;
    writerProvider: ProviderName;
    writerModel: string;
    maxIterations: number;
    enableSast: boolean;
    writeKeys: boolean;
    anthropicKey?: string;
    openaiKey?: string;
    googleKey?: string;
}
export declare const WRITER_MODEL_DEFAULTS: Record<ProviderName, string>;
export declare const READER_MODEL_DEFAULTS: Record<ProviderName, string>;
export declare function runInit(opts?: InitOptions): Promise<void>;
export declare function generateConfig(a: InitAnswers): string;
export declare const SECURE_REVIEW_ENV_MARKER = "# === secure-review ===";
export declare function generateEnv(a: InitAnswers): string;
//# sourceMappingURL=init.d.ts.map