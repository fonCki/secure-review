import { type Finding, type SeverityBreakdown } from './schema.js';
/**
 * Deduplicate and merge findings across reviewers.
 *
 * Two findings are treated as the same issue if they share:
 *   - the same file
 *   - an overlapping line window (we bucket by lineStart//10)
 *   - the same CWE (or, when CWE is missing, the same 24-char title prefix)
 *
 * v2 (Bug 1, PR #3 audit): CWE is now part of the key. Pre-fix it was
 * deliberately excluded, but live smoke tests showed two distinct CWEs in
 * the same 10-line bucket silently merged with mismatched title vs
 * description (kept first finding's title+CWE, overwrote description from
 * second). See `findingFingerprint` in identity.ts for the full algorithm.
 *
 * On merge (when fingerprints match):
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