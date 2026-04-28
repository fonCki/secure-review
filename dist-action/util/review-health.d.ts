import type { ReviewerRunOutput } from '../roles/reviewer.js';
export type ReviewHealthStatus = 'ok' | 'degraded' | 'failed';
export interface ReviewHealthSummary {
    reviewStatus: ReviewHealthStatus;
    failedReviewers: string[];
    succeededReviewers: string[];
}
export declare function summarizeReviewHealth(runs: ReviewerRunOutput[]): ReviewHealthSummary;
//# sourceMappingURL=review-health.d.ts.map