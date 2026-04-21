import type { Env, SecureReviewConfig } from '../config/schema.js';
import type { Finding, SeverityBreakdown } from '../findings/schema.js';
import { type ReviewerRunOutput } from '../roles/reviewer.js';
import { type WriterRunOutput } from '../roles/writer.js';
export interface FixModeInput {
    root: string;
    config: SecureReviewConfig;
    configDir: string;
    env: Env;
}
export interface IterationRecord {
    iteration: number;
    reviewer: string;
    reviewerRun: ReviewerRunOutput;
    sastBefore: {
        semgrep: number;
        eslint: number;
        npmAudit: number;
    };
    sastAfter: {
        semgrep: number;
        eslint: number;
        npmAudit: number;
    };
    writerRun?: WriterRunOutput;
    findingsBefore: Finding[];
    findingsAfter: Finding[];
    newCritical: number;
    resolved: number;
    costUSD: number;
}
export interface FixModeOutput {
    initialFindings: Finding[];
    finalFindings: Finding[];
    initialBreakdown: SeverityBreakdown;
    finalBreakdown: SeverityBreakdown;
    iterations: IterationRecord[];
    gateBlocked: boolean;
    gateReasons: string[];
    filesChanged: string[];
    totalCostUSD: number;
    totalDurationMs: number;
    verification?: ReviewerRunOutput[];
}
export declare function runFixMode(input: FixModeInput): Promise<FixModeOutput>;
//# sourceMappingURL=fix.d.ts.map