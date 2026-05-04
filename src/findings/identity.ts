import type { Finding } from './schema.js';

/**
 * Identifier for the current fingerprint algorithm. Recorded in evidence JSON
 * so old runs (different algorithm) and new runs are distinguishable post-hoc.
 * Bump this string whenever the algorithm in `findingFingerprint()` changes.
 */
export const FINGERPRINT_ALGORITHM = 'v2-file-bucket-cwe';

/** First N chars of the title used as a CWE-less fallback in the fingerprint. */
const TITLE_PREFIX_LEN = 24;

/**
 * Stable identity key for a finding.
 *
 * Used by:
 *   - the aggregator   → deduplicate findings within a single run
 *   - the iteration diff → match the same finding across writer iterations
 *   - the baseline      → match accepted findings across runs
 *
 * v2 (Bug 1, PR #3 audit): includes the CWE in the key so two genuinely-
 * distinct vulnerabilities in the same 10-line bucket of the same file
 * stay separate. Pre-fix the key was `{file, lineBucket}` only, so an SQL
 * injection at line 7 and a command injection at line 13 of the same file
 * both fingerprinted to `file::0` and the second got merged into the first
 * with mismatched title vs description (the merge keeps the first finding's
 * title + CWE but overwrites the description with whatever was longer).
 *
 * Findings without a CWE fall back to a 24-char title prefix so the same
 * "Missing auth check" reported by two reviewers (no CWE) still merges,
 * but a CWE-less "Missing auth check" and a CWE-less "Hardcoded credential"
 * in the same bucket stay separate.
 *
 * The 10-line bucket gives us tolerance for small writer-induced line shifts
 * (e.g. an added import pushing the bug down a few lines).
 */
export function findingFingerprint(f: Pick<Finding, 'file' | 'lineStart' | 'cwe' | 'title'>): string {
  const bucket = Math.floor(f.lineStart / 10);
  const cweOrTitle = f.cwe && f.cwe.trim().length > 0
    ? f.cwe.trim()
    : (f.title ?? '').trim().slice(0, TITLE_PREFIX_LEN);
  return `${f.file}::${bucket}::${cweOrTitle}`;
}

/**
 * Session-scoped registry assigning a stable ID to each unique finding
 * the first time it is seen, and reusing that ID for every subsequent
 * sighting (across iterations of the fix loop).
 *
 * Stable IDs survive the aggregator's per-call `F-NN` renumbering, so
 * downstream consumers (markdown report, evidence JSON, thesis plots)
 * can track "same bug" across iterations even when the verifier reports
 * it with a slightly different line number or title than before.
 */
export class FindingRegistry {
  private readonly idsByFingerprint = new Map<string, string>();
  private next = 1;

  /** Assign or look up a stable ID for `f`. */
  register(f: Finding): string {
    const fp = findingFingerprint(f);
    const existing = this.idsByFingerprint.get(fp);
    if (existing) return existing;
    const id = `S-${String(this.next).padStart(3, '0')}`;
    this.idsByFingerprint.set(fp, id);
    this.next += 1;
    return id;
  }

  /** Register every finding and return a parallel stableId array. */
  registerAll(findings: Finding[]): string[] {
    return findings.map((f) => this.register(f));
  }

  /**
   * Annotate `findings` in-place with their stable IDs and return the
   * same array. Convenience for callers that want to thread stableId
   * onto the existing finding objects without copying.
   */
  annotate(findings: Finding[]): Finding[] {
    for (const f of findings) f.stableId = this.register(f);
    return findings;
  }

  /** Number of distinct findings ever seen. */
  size(): number {
    return this.idsByFingerprint.size;
  }
}
