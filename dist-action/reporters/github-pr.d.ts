import type { ReviewModeOutput } from '../modes/review.js';
export interface PrPostOptions {
    owner: string;
    repo: string;
    prNumber: number;
    commitSha: string;
    token: string;
    /** Only post comments on files that are in the PR diff. */
    changedFiles: Set<string>;
}
/**
 * Posts the aggregated findings as a single GitHub PR review with
 * line-anchored comments. Comments are posted only for files that are
 * part of the PR diff (to avoid surfacing findings in unchanged files).
 */
export declare function postPrReview(output: ReviewModeOutput, opts: PrPostOptions): Promise<void>;
//# sourceMappingURL=github-pr.d.ts.map