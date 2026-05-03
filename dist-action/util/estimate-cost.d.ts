import type { SecureReviewConfig } from '../config/schema.js';
import { type FileContent } from './files.js';
export type EstimateMode = 'review' | 'fix';
export interface EstimateInput {
    config: SecureReviewConfig;
    files: FileContent[];
    mode: EstimateMode;
}
export interface ModelEstimate {
    role: 'reviewer' | 'writer';
    name: string;
    model: string;
    calls: number;
    inputTokensPerCall: number;
    outputTokensPerCall: number;
    totalCostUSD: number;
    knownPricing: boolean;
}
export interface CostEstimate {
    perModel: ModelEstimate[];
    totalCostUSD: number;
    /** Lower bound (currently 0.7×) — output volume often comes in under projection. */
    bandLowUSD: number;
    /** Upper bound (currently 1.3×) — covers verbose models and retried writer calls. */
    bandHighUSD: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    unknownPricingModels: string[];
    notes: string[];
    fileCount: number;
}
export declare function estimateRunCost(input: EstimateInput): CostEstimate;
export declare function formatEstimateText(est: CostEstimate, mode: EstimateMode, capUSD?: number): string;
//# sourceMappingURL=estimate-cost.d.ts.map