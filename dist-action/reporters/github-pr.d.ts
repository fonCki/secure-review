import type { ReviewModeOutput } from '../modes/review.js';
export interface PrPostOptions {
    owner: string;
    repo: string;
    prNumber: number;
    commitSha: string;
    token: string;
    /**
     * Map of changed-file path → Set of new-file line numbers that are valid
     * anchor points for a PR review comment (i.e. lines that appear in the
     * diff hunks, either added or context). GitHub's pulls/{n}/reviews endpoint
     * refuses comments on any line outside this set with 422 "Line could not
     * be resolved" — so we must filter findings before posting.
     */
    commentableLines: Map<string, Set<number>>;
}
export interface PrPostResult {
    inlineCount: number;
    summaryOnlyCount: number;
    criticalOnDiff: number;
}
/**
 * Posts the aggregated findings as a single GitHub PR review.
 *
 * Findings that land on a line present in the PR diff become line-anchored
 * inline comments. Findings in changed files but on lines outside the diff
 * (i.e. pre-existing issues in files the PR touches elsewhere) are listed
 * in the summary body instead of being posted inline — if we tried to post
 * them inline, GitHub would reject the whole review with 422 and the tool
 * would crash.
 *
 * Findings in files the PR doesn't touch at all are dropped (noise).
 */
export declare function postPrReview(output: ReviewModeOutput, opts: PrPostOptions): Promise<PrPostResult>;
//# sourceMappingURL=github-pr.d.ts.map