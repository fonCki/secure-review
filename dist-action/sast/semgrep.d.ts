import type { Finding } from '../findings/schema.js';
export interface SemgrepResult {
    available: boolean;
    findings: Finding[];
    raw?: unknown;
    error?: string;
}
/**
 * Invokes Semgrep with the same rulesets as the experiment's scan.sh
 * (secure-code-despite-ai/pipeline/scan.sh lines 29–56). Normalizes the
 * output into Finding[] so it can be aggregated alongside AI reviewer
 * findings.
 */
export declare function runSemgrep(path: string, reviewerName?: string): Promise<SemgrepResult>;
//# sourceMappingURL=semgrep.d.ts.map