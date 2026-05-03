import type { SecureReviewConfig } from '../config/schema.js';
import type { Finding } from '../findings/schema.js';
export interface SastSummary {
    findings: Finding[];
    semgrep: {
        ran: boolean;
        count: number;
        error?: string;
    };
    eslint: {
        ran: boolean;
        count: number;
        error?: string;
    };
    npmAudit: {
        ran: boolean;
        count: number;
        error?: string;
    };
}
/**
 * Filter a SAST summary down to only findings whose `file` is in the given
 * set of scan-root-relative paths. Used by `--since` incremental mode in
 * review.ts and fix.ts to drop SAST findings outside the changed file set.
 *
 * SAST tools (semgrep / eslint / npm-audit) scan the entire scan root and
 * have no native --since support, so we run them full-tree and post-filter.
 * The per-tool counts in the summary are recomputed to match the filtered
 * findings so log output and JSON evidence stay consistent.
 *
 * Bug 9 (PR #3 audit).
 */
export declare function filterSastByPaths(summary: SastSummary, only: Set<string>): SastSummary;
export declare function runAllSast(path: string, config: SecureReviewConfig['sast']): Promise<SastSummary>;
//# sourceMappingURL=index.d.ts.map