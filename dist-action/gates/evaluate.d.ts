import type { SecureReviewConfig } from '../config/schema.js';
import type { Finding } from '../findings/schema.js';
export interface GateContext {
    beforeFindings: Finding[];
    afterFindings: Finding[];
    cumulativeCostUSD: number;
    elapsedMs: number;
    iteration: number;
}
export interface GateDecision {
    proceed: boolean;
    reasons: string[];
}
export declare function evaluateGates(ctx: GateContext, config: SecureReviewConfig['gates']): GateDecision;
//# sourceMappingURL=evaluate.d.ts.map