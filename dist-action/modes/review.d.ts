import type { Env, SecureReviewConfig } from '../config/schema.js';
import { type Baseline } from '../findings/baseline.js';
import type { Finding, SeverityBreakdown } from '../findings/schema.js';
import { type ReviewerRunOutput } from '../roles/reviewer.js';
import { type SastSummary } from '../sast/index.js';
import { type ReviewHealthStatus } from '../util/review-health.js';
export interface ReviewModeInput {
    root: string;
    config: SecureReviewConfig;
    configDir: string;
    env: Env;
    /** If set, only files whose relPath is in this set are reviewed (incremental mode). */
    only?: Set<string>;
    /** If set, findings whose fingerprint matches a baseline entry are suppressed. */
    baseline?: Baseline;
}
export interface ReviewModeOutput {
    findings: Finding[];
    breakdown: SeverityBreakdown;
    sast: SastSummary;
    perReviewer: ReviewerRunOutput[];
    reviewStatus: ReviewHealthStatus;
    failedReviewers: string[];
    succeededReviewers: string[];
    totalCostUSD: number;
    totalDurationMs: number;
    /** Findings suppressed by the baseline (already excluded from `findings`). */
    baselineSuppressed: Finding[];
}
export declare function runReviewMode(input: ReviewModeInput): Promise<ReviewModeOutput>;
//# sourceMappingURL=review.d.ts.map