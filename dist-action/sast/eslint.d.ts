import type { Finding } from '../findings/schema.js';
export interface EslintResult {
    available: boolean;
    findings: Finding[];
    error?: string;
}
/**
 * Runs ESLint with the target project's flat config (eslint.config.{js,mjs,cjs}).
 * Returns `available: false` with a one-line reason if no config is reachable
 * from the scan root, instead of dumping ESLint v9's wall-of-text migration
 * message. Also returns `available: false` if eslint itself isn't installed.
 */
export declare function runEslint(path: string, reviewerName?: string): Promise<EslintResult>;
//# sourceMappingURL=eslint.d.ts.map