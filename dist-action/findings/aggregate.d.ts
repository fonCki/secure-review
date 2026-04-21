import { type Finding, type SeverityBreakdown } from './schema.js';
/**
 * Deduplicate and merge findings across reviewers.
 *
 * Two findings are treated as the same issue if they share:
 *   - the same file
 *   - an overlapping line window (we bucket by lineStart//10)
 *   - the same CWE (or both missing a CWE but same title prefix)
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
//# sourceMappingURL=aggregate.d.ts.map