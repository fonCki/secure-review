export interface InitOptions {
    force?: boolean;
    yes?: boolean;
}
export interface InitAnswers {
    useAnthropic: boolean;
    useOpenAI: boolean;
    useGoogle: boolean;
    enableSast: boolean;
    writeKeys: boolean;
    anthropicKey?: string;
    openaiKey?: string;
    googleKey?: string;
}
export declare function runInit(opts?: InitOptions): Promise<void>;
export declare function generateConfig(a: InitAnswers): string;
export declare const SECURE_REVIEW_ENV_MARKER = "# === secure-review ===";
export declare function generateEnv(a: InitAnswers): string;
//# sourceMappingURL=init.d.ts.map