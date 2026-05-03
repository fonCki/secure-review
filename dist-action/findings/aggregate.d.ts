import { type Finding, type SeverityBreakdown } from './schema.js';
/**
 * Deduplicate and merge findings across reviewers.
 *
 * Two findings are treated as the same issue if they share:
 *   - the same file
 *   - an overlapping line window (we bucket by lineStart//10)
 *
 * NOTE: We intentionally do NOT include CWE in the deduplication key because
 * different models/tools often assign different CWEs to the same underlying bug,
 * which would prevent cross-model merges and depress agreement.
 *
 * On merge:
 *   - keep the highest severity
 *   - union `reportedBy`
 *   - prefer the most detailed description / remediation
 *   - confidence = min(1, reportedBy.length / 3)
 */
export declare function aggregate(findings: Finding[]): Finding[];
export declare function severityBreakdown(findings: Finding[]): SeverityBreakdown;
export declare function countBySeverity(findings: Finding[], severity: Finding['severity']): number;
/** Number of distinct models that reported this finding. */
export declare function agreementCount(finding: Finding): number;
//# sourceMappingURL=aggregate.d.ts.map