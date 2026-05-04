import { z } from 'zod';
export declare const Provider: z.ZodEnum<["anthropic", "openai", "google"]>;
export type Provider = z.infer<typeof Provider>;
export declare const ProviderMode: z.ZodEnum<["api", "cli"]>;
export type ProviderMode = z.infer<typeof ProviderMode>;
export declare const ModelRef: z.ZodObject<{
    provider: z.ZodEnum<["anthropic", "openai", "google"]>;
    model: z.ZodString;
    skill: z.ZodString;
    /** Optional display name. Reviewers use `name`; writer infers from role. */
    name: z.ZodOptional<z.ZodString>;
    /** Optional cap per single invocation (tokens). */
    maxTokens: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    provider: "anthropic" | "openai" | "google";
    model: string;
    skill: string;
    name?: string | undefined;
    maxTokens?: number | undefined;
}, {
    provider: "anthropic" | "openai" | "google";
    model: string;
    skill: string;
    name?: string | undefined;
    maxTokens?: number | undefined;
}>;
export type ModelRef = z.infer<typeof ModelRef>;
export declare const ReviewerRef: z.ZodObject<{
    provider: z.ZodEnum<["anthropic", "openai", "google"]>;
    model: z.ZodString;
    skill: z.ZodString;
    maxTokens: z.ZodOptional<z.ZodNumber>;
} & {
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    provider: "anthropic" | "openai" | "google";
    model: string;
    skill: string;
    name: string;
    maxTokens?: number | undefined;
}, {
    provider: "anthropic" | "openai" | "google";
    model: string;
    skill: string;
    name: string;
    maxTokens?: number | undefined;
}>;
export type ReviewerRef = z.infer<typeof ReviewerRef>;
export declare const SastConfig: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    tools: z.ZodDefault<z.ZodArray<z.ZodEnum<["semgrep", "eslint", "npm_audit"]>, "many">>;
    inject_into_reviewer_context: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    tools: ("semgrep" | "eslint" | "npm_audit")[];
    inject_into_reviewer_context: boolean;
}, {
    enabled?: boolean | undefined;
    tools?: ("semgrep" | "eslint" | "npm_audit")[] | undefined;
    inject_into_reviewer_context?: boolean | undefined;
}>;
export declare const ReviewConfig: z.ZodObject<{
    parallel: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    parallel: boolean;
}, {
    parallel?: boolean | undefined;
}>;
export declare const FixConfig: z.ZodObject<{
    mode: z.ZodDefault<z.ZodEnum<["sequential_rotation", "parallel_aggregate"]>>;
    max_iterations: z.ZodDefault<z.ZodNumber>;
    final_verification: z.ZodDefault<z.ZodEnum<["all_reviewers", "first_reviewer", "none"]>>;
    /** Only send findings with confidence >= this threshold to the writer (0 = no filter). */
    min_confidence_to_fix: z.ZodDefault<z.ZodNumber>;
    /** Only send findings at or above this severity to the writer (default 'INFO' = all). */
    min_severity_to_fix: z.ZodDefault<z.ZodEnum<["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]>>;
}, "strip", z.ZodTypeAny, {
    mode: "sequential_rotation" | "parallel_aggregate";
    max_iterations: number;
    final_verification: "all_reviewers" | "first_reviewer" | "none";
    min_confidence_to_fix: number;
    min_severity_to_fix: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
}, {
    mode?: "sequential_rotation" | "parallel_aggregate" | undefined;
    max_iterations?: number | undefined;
    final_verification?: "all_reviewers" | "first_reviewer" | "none" | undefined;
    min_confidence_to_fix?: number | undefined;
    min_severity_to_fix?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO" | undefined;
}>;
export declare const GatesConfig: z.ZodObject<{
    block_on_new_critical: z.ZodDefault<z.ZodBoolean>;
    block_on_new_high: z.ZodDefault<z.ZodBoolean>;
    max_cost_usd: z.ZodDefault<z.ZodNumber>;
    max_wall_time_minutes: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    block_on_new_critical: boolean;
    block_on_new_high: boolean;
    max_cost_usd: number;
    max_wall_time_minutes: number;
}, {
    block_on_new_critical?: boolean | undefined;
    block_on_new_high?: boolean | undefined;
    max_cost_usd?: number | undefined;
    max_wall_time_minutes?: number | undefined;
}>;
export declare const DynamicCheck: z.ZodEnum<["headers", "cookies", "cors", "sensitive_paths"]>;
export type DynamicCheck = z.infer<typeof DynamicCheck>;
export declare const DynamicConfig: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    /** Optional runtime target (used by `secure-review-runtime`; overridable with `--target-url` there). */
    target_url: z.ZodOptional<z.ZodString>;
    healthcheck_url: z.ZodOptional<z.ZodString>;
    timeout_seconds: z.ZodDefault<z.ZodNumber>;
    max_requests: z.ZodDefault<z.ZodNumber>;
    rate_limit_per_second: z.ZodDefault<z.ZodNumber>;
    max_crawl_pages: z.ZodDefault<z.ZodNumber>;
    attacker: z.ZodOptional<z.ZodObject<{
        provider: z.ZodEnum<["anthropic", "openai", "google"]>;
        model: z.ZodString;
        skill: z.ZodString;
        /** Optional display name. Reviewers use `name`; writer infers from role. */
        name: z.ZodOptional<z.ZodString>;
        /** Optional cap per single invocation (tokens). */
        maxTokens: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
    }, {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
    }>>;
    checks: z.ZodDefault<z.ZodArray<z.ZodEnum<["headers", "cookies", "cors", "sensitive_paths"]>, "many">>;
    sensitive_paths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    gates: z.ZodDefault<z.ZodObject<{
        block_on_confirmed_critical: z.ZodDefault<z.ZodBoolean>;
        block_on_confirmed_high: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        block_on_confirmed_critical: boolean;
        block_on_confirmed_high: boolean;
    }, {
        block_on_confirmed_critical?: boolean | undefined;
        block_on_confirmed_high?: boolean | undefined;
    }>>;
    /**
     * Optional headers for future runtime tooling. Core `secure-review` is static-only;
     * use `secure-review-runtime` for live probes. Kept for config compatibility.
     */
    auth_headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    gates: {
        block_on_confirmed_critical: boolean;
        block_on_confirmed_high: boolean;
    };
    timeout_seconds: number;
    max_requests: number;
    rate_limit_per_second: number;
    max_crawl_pages: number;
    sensitive_paths: string[];
    checks: ("headers" | "cookies" | "cors" | "sensitive_paths")[];
    target_url?: string | undefined;
    healthcheck_url?: string | undefined;
    attacker?: {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
    } | undefined;
    auth_headers?: Record<string, string> | undefined;
}, {
    enabled?: boolean | undefined;
    gates?: {
        block_on_confirmed_critical?: boolean | undefined;
        block_on_confirmed_high?: boolean | undefined;
    } | undefined;
    target_url?: string | undefined;
    healthcheck_url?: string | undefined;
    timeout_seconds?: number | undefined;
    max_requests?: number | undefined;
    rate_limit_per_second?: number | undefined;
    max_crawl_pages?: number | undefined;
    attacker?: {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
    } | undefined;
    sensitive_paths?: string[] | undefined;
    checks?: ("headers" | "cookies" | "cors" | "sensitive_paths")[] | undefined;
    auth_headers?: Record<string, string> | undefined;
}>;
export type DynamicConfig = z.infer<typeof DynamicConfig>;
export declare const OutputConfig: z.ZodObject<{
    report: z.ZodDefault<z.ZodString>;
    findings: z.ZodDefault<z.ZodString>;
    diff: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    report: string;
    findings: string;
    diff: string;
}, {
    report?: string | undefined;
    findings?: string | undefined;
    diff?: string | undefined;
}>;
export declare const SecureReviewConfigSchema: z.ZodObject<{
    writer: z.ZodObject<{
        provider: z.ZodEnum<["anthropic", "openai", "google"]>;
        model: z.ZodString;
        skill: z.ZodString;
        /** Optional display name. Reviewers use `name`; writer infers from role. */
        name: z.ZodOptional<z.ZodString>;
        /** Optional cap per single invocation (tokens). */
        maxTokens: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
    }, {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
    }>;
    /** Optional list of additional writer models for benchmarking. */
    writers: z.ZodOptional<z.ZodArray<z.ZodObject<{
        provider: z.ZodEnum<["anthropic", "openai", "google"]>;
        model: z.ZodString;
        skill: z.ZodString;
        /** Optional display name. Reviewers use `name`; writer infers from role. */
        name: z.ZodOptional<z.ZodString>;
        /** Optional cap per single invocation (tokens). */
        maxTokens: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
    }, {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
    }>, "many">>;
    reviewers: z.ZodArray<z.ZodObject<{
        provider: z.ZodEnum<["anthropic", "openai", "google"]>;
        model: z.ZodString;
        skill: z.ZodString;
        maxTokens: z.ZodOptional<z.ZodNumber>;
    } & {
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name: string;
        maxTokens?: number | undefined;
    }, {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name: string;
        maxTokens?: number | undefined;
    }>, "many">;
    sast: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        tools: z.ZodDefault<z.ZodArray<z.ZodEnum<["semgrep", "eslint", "npm_audit"]>, "many">>;
        inject_into_reviewer_context: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        tools: ("semgrep" | "eslint" | "npm_audit")[];
        inject_into_reviewer_context: boolean;
    }, {
        enabled?: boolean | undefined;
        tools?: ("semgrep" | "eslint" | "npm_audit")[] | undefined;
        inject_into_reviewer_context?: boolean | undefined;
    }>>;
    review: z.ZodDefault<z.ZodObject<{
        parallel: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        parallel: boolean;
    }, {
        parallel?: boolean | undefined;
    }>>;
    fix: z.ZodDefault<z.ZodObject<{
        mode: z.ZodDefault<z.ZodEnum<["sequential_rotation", "parallel_aggregate"]>>;
        max_iterations: z.ZodDefault<z.ZodNumber>;
        final_verification: z.ZodDefault<z.ZodEnum<["all_reviewers", "first_reviewer", "none"]>>;
        /** Only send findings with confidence >= this threshold to the writer (0 = no filter). */
        min_confidence_to_fix: z.ZodDefault<z.ZodNumber>;
        /** Only send findings at or above this severity to the writer (default 'INFO' = all). */
        min_severity_to_fix: z.ZodDefault<z.ZodEnum<["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]>>;
    }, "strip", z.ZodTypeAny, {
        mode: "sequential_rotation" | "parallel_aggregate";
        max_iterations: number;
        final_verification: "all_reviewers" | "first_reviewer" | "none";
        min_confidence_to_fix: number;
        min_severity_to_fix: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
    }, {
        mode?: "sequential_rotation" | "parallel_aggregate" | undefined;
        max_iterations?: number | undefined;
        final_verification?: "all_reviewers" | "first_reviewer" | "none" | undefined;
        min_confidence_to_fix?: number | undefined;
        min_severity_to_fix?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO" | undefined;
    }>>;
    gates: z.ZodDefault<z.ZodObject<{
        block_on_new_critical: z.ZodDefault<z.ZodBoolean>;
        block_on_new_high: z.ZodDefault<z.ZodBoolean>;
        max_cost_usd: z.ZodDefault<z.ZodNumber>;
        max_wall_time_minutes: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        block_on_new_critical: boolean;
        block_on_new_high: boolean;
        max_cost_usd: number;
        max_wall_time_minutes: number;
    }, {
        block_on_new_critical?: boolean | undefined;
        block_on_new_high?: boolean | undefined;
        max_cost_usd?: number | undefined;
        max_wall_time_minutes?: number | undefined;
    }>>;
    dynamic: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        /** Optional runtime target (used by `secure-review-runtime`; overridable with `--target-url` there). */
        target_url: z.ZodOptional<z.ZodString>;
        healthcheck_url: z.ZodOptional<z.ZodString>;
        timeout_seconds: z.ZodDefault<z.ZodNumber>;
        max_requests: z.ZodDefault<z.ZodNumber>;
        rate_limit_per_second: z.ZodDefault<z.ZodNumber>;
        max_crawl_pages: z.ZodDefault<z.ZodNumber>;
        attacker: z.ZodOptional<z.ZodObject<{
            provider: z.ZodEnum<["anthropic", "openai", "google"]>;
            model: z.ZodString;
            skill: z.ZodString;
            /** Optional display name. Reviewers use `name`; writer infers from role. */
            name: z.ZodOptional<z.ZodString>;
            /** Optional cap per single invocation (tokens). */
            maxTokens: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            provider: "anthropic" | "openai" | "google";
            model: string;
            skill: string;
            name?: string | undefined;
            maxTokens?: number | undefined;
        }, {
            provider: "anthropic" | "openai" | "google";
            model: string;
            skill: string;
            name?: string | undefined;
            maxTokens?: number | undefined;
        }>>;
        checks: z.ZodDefault<z.ZodArray<z.ZodEnum<["headers", "cookies", "cors", "sensitive_paths"]>, "many">>;
        sensitive_paths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        gates: z.ZodDefault<z.ZodObject<{
            block_on_confirmed_critical: z.ZodDefault<z.ZodBoolean>;
            block_on_confirmed_high: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            block_on_confirmed_critical: boolean;
            block_on_confirmed_high: boolean;
        }, {
            block_on_confirmed_critical?: boolean | undefined;
            block_on_confirmed_high?: boolean | undefined;
        }>>;
        /**
         * Optional headers for future runtime tooling. Core `secure-review` is static-only;
         * use `secure-review-runtime` for live probes. Kept for config compatibility.
         */
        auth_headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        gates: {
            block_on_confirmed_critical: boolean;
            block_on_confirmed_high: boolean;
        };
        timeout_seconds: number;
        max_requests: number;
        rate_limit_per_second: number;
        max_crawl_pages: number;
        sensitive_paths: string[];
        checks: ("headers" | "cookies" | "cors" | "sensitive_paths")[];
        target_url?: string | undefined;
        healthcheck_url?: string | undefined;
        attacker?: {
            provider: "anthropic" | "openai" | "google";
            model: string;
            skill: string;
            name?: string | undefined;
            maxTokens?: number | undefined;
        } | undefined;
        auth_headers?: Record<string, string> | undefined;
    }, {
        enabled?: boolean | undefined;
        gates?: {
            block_on_confirmed_critical?: boolean | undefined;
            block_on_confirmed_high?: boolean | undefined;
        } | undefined;
        target_url?: string | undefined;
        healthcheck_url?: string | undefined;
        timeout_seconds?: number | undefined;
        max_requests?: number | undefined;
        rate_limit_per_second?: number | undefined;
        max_crawl_pages?: number | undefined;
        attacker?: {
            provider: "anthropic" | "openai" | "google";
            model: string;
            skill: string;
            name?: string | undefined;
            maxTokens?: number | undefined;
        } | undefined;
        sensitive_paths?: string[] | undefined;
        checks?: ("headers" | "cookies" | "cors" | "sensitive_paths")[] | undefined;
        auth_headers?: Record<string, string> | undefined;
    }>>;
    output: z.ZodDefault<z.ZodObject<{
        report: z.ZodDefault<z.ZodString>;
        findings: z.ZodDefault<z.ZodString>;
        diff: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        report: string;
        findings: string;
        diff: string;
    }, {
        report?: string | undefined;
        findings?: string | undefined;
        diff?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    writer: {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
    };
    reviewers: {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name: string;
        maxTokens?: number | undefined;
    }[];
    sast: {
        enabled: boolean;
        tools: ("semgrep" | "eslint" | "npm_audit")[];
        inject_into_reviewer_context: boolean;
    };
    review: {
        parallel: boolean;
    };
    fix: {
        mode: "sequential_rotation" | "parallel_aggregate";
        max_iterations: number;
        final_verification: "all_reviewers" | "first_reviewer" | "none";
        min_confidence_to_fix: number;
        min_severity_to_fix: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
    };
    gates: {
        block_on_new_critical: boolean;
        block_on_new_high: boolean;
        max_cost_usd: number;
        max_wall_time_minutes: number;
    };
    dynamic: {
        enabled: boolean;
        gates: {
            block_on_confirmed_critical: boolean;
            block_on_confirmed_high: boolean;
        };
        timeout_seconds: number;
        max_requests: number;
        rate_limit_per_second: number;
        max_crawl_pages: number;
        sensitive_paths: string[];
        checks: ("headers" | "cookies" | "cors" | "sensitive_paths")[];
        target_url?: string | undefined;
        healthcheck_url?: string | undefined;
        attacker?: {
            provider: "anthropic" | "openai" | "google";
            model: string;
            skill: string;
            name?: string | undefined;
            maxTokens?: number | undefined;
        } | undefined;
        auth_headers?: Record<string, string> | undefined;
    };
    output: {
        report: string;
        findings: string;
        diff: string;
    };
    writers?: {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
    }[] | undefined;
}, {
    writer: {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
    };
    reviewers: {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name: string;
        maxTokens?: number | undefined;
    }[];
    writers?: {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
    }[] | undefined;
    sast?: {
        enabled?: boolean | undefined;
        tools?: ("semgrep" | "eslint" | "npm_audit")[] | undefined;
        inject_into_reviewer_context?: boolean | undefined;
    } | undefined;
    review?: {
        parallel?: boolean | undefined;
    } | undefined;
    fix?: {
        mode?: "sequential_rotation" | "parallel_aggregate" | undefined;
        max_iterations?: number | undefined;
        final_verification?: "all_reviewers" | "first_reviewer" | "none" | undefined;
        min_confidence_to_fix?: number | undefined;
        min_severity_to_fix?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO" | undefined;
    } | undefined;
    gates?: {
        block_on_new_critical?: boolean | undefined;
        block_on_new_high?: boolean | undefined;
        max_cost_usd?: number | undefined;
        max_wall_time_minutes?: number | undefined;
    } | undefined;
    dynamic?: {
        enabled?: boolean | undefined;
        gates?: {
            block_on_confirmed_critical?: boolean | undefined;
            block_on_confirmed_high?: boolean | undefined;
        } | undefined;
        target_url?: string | undefined;
        healthcheck_url?: string | undefined;
        timeout_seconds?: number | undefined;
        max_requests?: number | undefined;
        rate_limit_per_second?: number | undefined;
        max_crawl_pages?: number | undefined;
        attacker?: {
            provider: "anthropic" | "openai" | "google";
            model: string;
            skill: string;
            name?: string | undefined;
            maxTokens?: number | undefined;
        } | undefined;
        sensitive_paths?: string[] | undefined;
        checks?: ("headers" | "cookies" | "cors" | "sensitive_paths")[] | undefined;
        auth_headers?: Record<string, string> | undefined;
    } | undefined;
    output?: {
        report?: string | undefined;
        findings?: string | undefined;
        diff?: string | undefined;
    } | undefined;
}>;
export type SecureReviewConfig = z.infer<typeof SecureReviewConfigSchema>;
export declare const EnvSchema: z.ZodObject<{
    ANTHROPIC_API_KEY: z.ZodOptional<z.ZodString>;
    OPENAI_API_KEY: z.ZodOptional<z.ZodString>;
    GOOGLE_API_KEY: z.ZodOptional<z.ZodString>;
    ANTHROPIC_MODE: z.ZodDefault<z.ZodEnum<["api", "cli"]>>;
    OPENAI_MODE: z.ZodDefault<z.ZodEnum<["api", "cli"]>>;
    GOOGLE_MODE: z.ZodDefault<z.ZodEnum<["api", "cli"]>>;
    CLAUDE_CLI_BIN: z.ZodDefault<z.ZodString>;
    GEMINI_CLI_BIN: z.ZodDefault<z.ZodString>;
    GITHUB_TOKEN: z.ZodOptional<z.ZodString>;
    GITHUB_ACTIONS: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    ANTHROPIC_MODE: "api" | "cli";
    OPENAI_MODE: "api" | "cli";
    GOOGLE_MODE: "api" | "cli";
    CLAUDE_CLI_BIN: string;
    GEMINI_CLI_BIN: string;
    GITHUB_ACTIONS?: string | undefined;
    ANTHROPIC_API_KEY?: string | undefined;
    OPENAI_API_KEY?: string | undefined;
    GOOGLE_API_KEY?: string | undefined;
    GITHUB_TOKEN?: string | undefined;
}, {
    GITHUB_ACTIONS?: string | undefined;
    ANTHROPIC_API_KEY?: string | undefined;
    OPENAI_API_KEY?: string | undefined;
    GOOGLE_API_KEY?: string | undefined;
    ANTHROPIC_MODE?: "api" | "cli" | undefined;
    OPENAI_MODE?: "api" | "cli" | undefined;
    GOOGLE_MODE?: "api" | "cli" | undefined;
    CLAUDE_CLI_BIN?: string | undefined;
    GEMINI_CLI_BIN?: string | undefined;
    GITHUB_TOKEN?: string | undefined;
}>;
export type Env = z.infer<typeof EnvSchema>;
//# sourceMappingURL=schema.d.ts.map