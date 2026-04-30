import type { Finding } from './schema.js';
/**
 * Stable identity key for a finding.
 *
 * Used by:
 *   - the aggregator   → deduplicate findings within a single run
 *   - the iteration diff → match the same finding across writer iterations
 *   - the baseline      → match accepted findings across runs
 *
 * Uses `{file, lineBucket}` only. CWE and title are deliberately *excluded*
 * because models routinely disagree on those for the same underlying bug
 * (e.g. CWE-78 vs CWE-787 for the same command-injection line, or two
 * different titles like "Missing auth check" vs "Unauthenticated endpoint").
 * Including them inflates the apparent "introduced" count in the fix loop
 * because the same bug becomes a separate identity each iteration.
 *
 * The 10-line bucket gives us tolerance for small writer-induced line shifts
 * (e.g. an added import pushing the bug down a few lines).
 */
export declare function findingFingerprint(f: Pick<Finding, 'file' | 'lineStart'>): string;
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
export declare class FindingRegistry {
    private readonly idsByFingerprint;
    private next;
    /** Assign or look up a stable ID for `f`. */
    register(f: Finding): string;
    /** Register every finding and return a parallel stableId array. */
    registerAll(findings: Finding[]): string[];
    /**
     * Annotate `findings` in-place with their stable IDs and return the
     * same array. Convenience for callers that want to thread stableId
     * onto the existing finding objects without copying.
     */
    annotate(findings: Finding[]): Finding[];
    /** Number of distinct findings ever seen. */
    size(): number;
}
//# sourceMappingURL=identity.d.ts.map