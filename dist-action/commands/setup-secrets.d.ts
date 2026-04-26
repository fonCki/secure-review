export interface SetupSecretsOptions {
    /** Override repo (default: gh detects from current git remote). e.g. `--repo fonCki/foo` */
    repo?: string;
    /** Path to .secure-review.yml */
    config?: string;
}
export declare function runSetupSecrets(opts?: SetupSecretsOptions): Promise<void>;
//# sourceMappingURL=setup-secrets.d.ts.map