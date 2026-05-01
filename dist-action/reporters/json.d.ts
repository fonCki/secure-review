import type { EvidenceJson } from '../findings/schema.js';
import type { AttackAiModeOutput } from '../modes/attack-ai.js';
import type { AttackModeOutput } from '../modes/attack.js';
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
export declare function renderFixEvidence(out: FixModeOutput, opts: JsonReportOptions): EvidenceJson & {
    runtime_attacks?: Array<{
        phase: string;
        target_url: string;
        pages: number;
        hypotheses: number;
        probes_total: number;
        probes_confirmed: number;
        findings: number;
        cost_usd: number;
    }>;
    initial_runtime_findings?: number;
    final_runtime_findings?: number;
};
export declare function renderAttackEvidence(out: AttackModeOutput, opts: JsonReportOptions): EvidenceJson & {
    target_url: string;
    checks: AttackModeOutput['checks'];
    runtime_findings: AttackModeOutput['findings'];
    gate_blocked: boolean;
    gate_reasons: string[];
};
export declare function renderAttackAiEvidence(out: AttackAiModeOutput, opts: JsonReportOptions): EvidenceJson & {
    target_url: string;
    crawled_pages: AttackAiModeOutput['pages'];
    hypotheses: AttackAiModeOutput['hypotheses'];
    probes: AttackAiModeOutput['probes'];
    runtime_findings: AttackAiModeOutput['findings'];
    gate_blocked: boolean;
    gate_reasons: string[];
    limits: AttackAiModeOutput['limits'];
};
//# sourceMappingURL=json.d.ts.map