import type { EvidenceJson } from '../findings/schema.js';
import type { FixModeOutput } from '../modes/fix.js';
import type { ReviewModeOutput } from '../modes/review.js';
export interface JsonReportOptions {
    taskId: string;
    run: number;
    sourceCondition?: string;
    modelVersion: string;
    sessionId?: string;
    reviewerNames: string[];
}
/**
 * Renders a Condition-D-compatible evidence JSON so Condition F results
 * plot directly against existing Condition C/D baselines.
 */
export declare function renderReviewEvidence(out: ReviewModeOutput, opts: JsonReportOptions): EvidenceJson;
export declare function renderFixEvidence(out: FixModeOutput, opts: JsonReportOptions): EvidenceJson;
//# sourceMappingURL=json.d.ts.map