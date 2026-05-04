import type { Env, SecureReviewConfig } from '../config/schema.js';
import type { Finding } from '../findings/schema.js';
export interface ReviewerStrategyResult {
    name: string;
    findings: Finding[];
    costUSD: number;
    durationMs: number;
    status: 'ok' | 'failed';
    missedVsCombined: Finding[];
    uniqueToThis: Finding[];
}
export interface ReviewerBenchmarkOutput {
    root: string;
    singleResults: ReviewerStrategyResult[];
    combinedFindings: Finding[];
    combinedCostUSD: number;
    totalDurationMs: number;
}
/**
 * Reviewer benchmark: runs each reviewer individually, then compares against
 * the combined multi-model result. Shows what each single model misses and
 * what the combined approach adds — empirical evidence for the multi-model design.
 */
export declare function runReviewerBenchmark(input: {
    root: string;
    config: SecureReviewConfig;
    configDir: string;
    env: Env;
}): Promise<ReviewerBenchmarkOutput>;
export declare function renderReviewerBenchmarkReport(output: ReviewerBenchmarkOutput): string;
//# sourceMappingURL=reviewer-benchmark.d.ts.map