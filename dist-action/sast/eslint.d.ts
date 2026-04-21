import type { Finding } from '../findings/schema.js';
export interface EslintResult {
    available: boolean;
    findings: Finding[];
    error?: string;
}
/**
 * Runs ESLint with eslint-plugin-security. Expects the target project to
 * have a working ESLint config; we pass --resolve-plugins-relative-to
 * to allow consuming repos to ship their own config. If eslint isn't
 * installed, gracefully returns available=false.
 */
export declare function runEslint(path: string, reviewerName?: string): Promise<EslintResult>;
//# sourceMappingURL=eslint.d.ts.map