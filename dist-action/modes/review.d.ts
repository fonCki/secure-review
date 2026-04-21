import type { Env, SecureReviewConfig } from '../config/schema.js';
import type { Finding, SeverityBreakdown } from '../findings/schema.js';
import { type ReviewerRunOutput } from '../roles/reviewer.js';
import { type SastSummary } from '../sast/index.js';
export interface ReviewModeInput {
    root: string;
    config: SecureReviewConfig;
    configDir: string;
    env: Env;
}
export interface ReviewModeOutput {
    findings: Finding[];
    breakdown: SeverityBreakdown;
    sast: SastSummary;
    perReviewer: ReviewerRunOutput[];
    totalCostUSD: number;
    totalDurationMs: number;
}
export declare function runReviewMode(input: ReviewModeInput): Promise<ReviewModeOutput>;
//# sourceMappingURL=review.d.ts.map