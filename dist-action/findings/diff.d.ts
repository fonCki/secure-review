import type { Finding } from './schema.js';
export interface FindingsDiff {
    resolved: Finding[];
    remaining: Finding[];
    introduced: Finding[];
}
/**
 * Compare two Finding[] sets.
 *
 * Identity is the shared `findingFingerprint` (file + 10-line bucket) so the
 * diff and aggregator always agree on what counts as "the same finding".
 * Previously diff also keyed on CWE/title-prefix, which inflated the
 * "introduced" count whenever models reported the same bug with a different
 * label across iterations — see `findings/identity.ts` for the rationale.
 */
export declare function diffFindings(before: Finding[], after: Finding[]): FindingsDiff;
//# sourceMappingURL=diff.d.ts.map