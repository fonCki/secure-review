import type { Env, SecureReviewConfig } from '../config/schema.js';
import type { Finding } from '../findings/schema.js';
import { type ReviewModeOutput } from './review.js';
export interface CompareModeInput {
    rootA: string;
    rootB: string;
    config: SecureReviewConfig;
    configDir: string;
    env: Env;
}
export interface CompareModeOutput {
    pathA: string;
    pathB: string;
    outputA: ReviewModeOutput;
    outputB: ReviewModeOutput;
    uniqueToA: Finding[];
    uniqueToB: Finding[];
    common: Finding[];
    delta: 'better' | 'worse' | 'same';
    totalDurationMs: number;
}
/**
 * Compare mode: runs review on two paths in parallel and produces a
 * side-by-side comparison showing unique/common findings and delta.
 */
export declare function runCompareMode(input: CompareModeInput): Promise<CompareModeOutput>;
/** Render the comparison as a markdown report. */
export declare function renderCompareReport(output: CompareModeOutput): string;
//# sourceMappingURL=compare.d.ts.map