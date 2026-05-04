import { findingFingerprint } from './identity.js';
import { SEVERITY_ORDER, type Finding, type SeverityBreakdown } from './schema.js';

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
export function aggregate(findings: Finding[]): Finding[] {
  const buckets = new Map<string, Finding>();
  let nextId = 1;

  for (const finding of findings) {
    const key = bucketKey(finding);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        ...finding,
        id: `F-${String(nextId).padStart(2, '0')}`,
      });
      nextId += 1;
      continue;
    }
    const merged = mergeFindings(existing, finding);
    buckets.set(key, merged);
  }

  return Array.from(buckets.values()).map((f) => ({
    ...f,
    confidence: Math.min(1, f.reportedBy.length / 3),
  }));
}

function bucketKey(f: Finding): string {
  return findingFingerprint(f);
}

function mergeFindings(a: Finding, b: Finding): Finding {
  const sev = SEVERITY_ORDER[a.severity] >= SEVERITY_ORDER[b.severity] ? a.severity : b.severity;
  const description = a.description.length >= b.description.length ? a.description : b.description;
  const remediation =
    (a.remediation?.length ?? 0) >= (b.remediation?.length ?? 0) ? a.remediation : b.remediation;
  const reportedBy = Array.from(new Set([...a.reportedBy, ...b.reportedBy]));
  return {
    ...a,
    severity: sev,
    description,
    remediation,
    reportedBy,
    cwe: a.cwe ?? b.cwe,
    owaspCategory: a.owaspCategory ?? b.owaspCategory,
  };
}

export function severityBreakdown(findings: Finding[]): SeverityBreakdown {
  const out: SeverityBreakdown = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  for (const f of findings) out[f.severity] += 1;
  return out;
}

export function countBySeverity(findings: Finding[], severity: Finding['severity']): number {
  return findings.filter((f) => f.severity === severity).length;
}

/** Number of distinct models that reported this finding. */
export function agreementCount(finding: Finding): number {
  return finding.reportedBy.length;
}
