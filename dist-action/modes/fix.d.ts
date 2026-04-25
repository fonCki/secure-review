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
/**
 * One iteration of the rotating fix loop.
 *
 * Semantics (since 0.5.0):
 *   - `findingsBefore`  — what the writer was asked to fix this iteration.
 *                         For iter 1 this is the union of all initial readers + SAST.
 *                         For iter N+1 this is the previous verifier's audit output.
 *   - `reviewer`        — the VERIFIER for this iteration (the model that audits
 *                         the writer's output afterwards). Rotates each iteration.
 *   - `findingsAfter`   — what the verifier saw post-writer (becomes next iter's
 *                         `findingsBefore`).
 */
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
/**
 * Cross-model rotating fix loop (Condition F, redesigned in 0.5.0).
 *
 * Workflow:
 *   1. INITIAL UNION SCAN — all readers in parallel + SAST. The aggregated
 *      union becomes the writer's first to-do list (no reader's blind spots
 *      get a free pass to slip past iteration 1).
 *   2. LOOP — for each iteration:
 *        a. Writer fixes the current to-do list.
 *        b. The next reader in rotation audits the writer's output (fresh eyes).
 *        c. That audit becomes the next to-do list.
 *      Stops only when a full rotation of readers all see clean (so a single
 *      lenient reader can't end the loop early), or when gates fire.
 *   3. FINAL VERIFICATION — all readers in parallel re-scan, in case the loop
 *      stopped on a single reader's "clean" (or gate-blocked) but other readers
 *      still see issues.
 */
export declare function runFixMode(input: FixModeInput): Promise<FixModeOutput>;
//# sourceMappingURL=fix.d.ts.map