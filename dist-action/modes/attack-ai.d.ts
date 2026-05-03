import type { ModelAdapter, Usage } from '../adapters/types.js';
import type { Env, ModelRef, Provider, SecureReviewConfig } from '../config/schema.js';
import type { Finding, SeverityBreakdown } from '../findings/schema.js';
export interface AttackAiModeInput {
    root: string;
    config: SecureReviewConfig;
    configDir: string;
    env: Env;
    targetUrl?: string;
    timeoutSeconds?: number;
    maxRequests?: number;
    maxCrawlPages?: number;
    rateLimitPerSecond?: number;
    attackerAdapter?: ModelAdapter;
    /** Preloaded skill body (test seam); if unset, skill is loaded from merged ref's skill path. */
    attackerSkill?: string;
    /**
     * Override attacker model vs `dynamic.attacker` / `writer` (CLI or API).
     * Unspecified fields still come from config (so you can set only `--attack-model`
     * and keep the provider from YAML).
     */
    attackerProvider?: Provider;
    attackerModel?: string;
    /** Skill path relative to config dir or absolute; overrides merged ref.skill when set. */
    attackerSkillPath?: string;
    /** Merged over `dynamic.auth_headers` for crawl, healthcheck, and probes. */
    authHeaders?: Record<string, string>;
}
export interface AttackAiPage {
    url: string;
    status: number;
    title?: string;
    links: string[];
    forms: AttackAiForm[];
}
export interface AttackAiForm {
    action: string;
    method: 'GET' | 'POST';
    fields: string[];
}
export type AttackAiProbeCategory = 'reflected_input' | 'error_disclosure' | 'open_redirect' | 'path_exposure';
export interface AttackAiHypothesis {
    id: string;
    category: AttackAiProbeCategory;
    severity: Finding['severity'];
    title: string;
    rationale: string;
    path: string;
    method: 'GET' | 'POST';
    parameter?: string;
    sourceFile?: string;
    lineStart?: number;
    remediation?: string;
}
export interface AttackAiProbeResult {
    hypothesisId: string;
    category: AttackAiProbeCategory;
    url: string;
    method: 'GET' | 'POST';
    status?: number;
    confirmed: boolean;
    durationMs: number;
    evidence: Record<string, unknown>;
    error?: string;
}
export interface AttackAiModeOutput {
    targetUrl: string;
    pages: AttackAiPage[];
    hypotheses: AttackAiHypothesis[];
    probes: AttackAiProbeResult[];
    findings: Finding[];
    breakdown: SeverityBreakdown;
    gateBlocked: boolean;
    gateReasons: string[];
    usage: Usage;
    totalCostUSD: number;
    totalDurationMs: number;
    limits: {
        maxRequests: number;
        maxCrawlPages: number;
        rateLimitPerSecond: number;
    };
    /** Effective attacker identity after merging config + CLI/API overrides. */
    attacker: {
        provider: string;
        model: string;
        skillPath: string;
    };
}
export declare function runAttackAiMode(input: AttackAiModeInput): Promise<AttackAiModeOutput>;
/** Merge `dynamic.attacker` (or writer) with optional CLI/API overrides. */
export declare function mergeAttackerRef(input: AttackAiModeInput): ModelRef;
//# sourceMappingURL=attack-ai.d.ts.map