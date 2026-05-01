import type { DynamicCheck, SecureReviewConfig } from '../config/schema.js';
import type { Finding, SeverityBreakdown } from '../findings/schema.js';
export interface AttackModeInput {
    root: string;
    config: SecureReviewConfig;
    targetUrl?: string;
    checks?: DynamicCheck[];
    timeoutSeconds?: number;
    /** Merged over `dynamic.auth_headers` (CLI / API overrides config). */
    authHeaders?: Record<string, string>;
}
export interface AttackCheckResult {
    check: DynamicCheck | 'healthcheck';
    url: string;
    method: string;
    status?: number;
    ok: boolean;
    durationMs: number;
    evidence: Record<string, unknown>;
    error?: string;
}
export interface AttackModeOutput {
    targetUrl: string;
    checks: AttackCheckResult[];
    findings: Finding[];
    breakdown: SeverityBreakdown;
    gateBlocked: boolean;
    gateReasons: string[];
    totalDurationMs: number;
}
export declare function runAttackMode(input: AttackModeInput): Promise<AttackModeOutput>;
//# sourceMappingURL=attack.d.ts.map