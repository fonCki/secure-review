import type { Finding } from './schema.js';
export interface FindingsDiff {
    resolved: Finding[];
    remaining: Finding[];
    introduced: Finding[];
}
/** Compare two Finding[] sets using the same bucket key as the aggregator. */
export declare function diffFindings(before: Finding[], after: Finding[]): FindingsDiff;
//# sourceMappingURL=diff.d.ts.map