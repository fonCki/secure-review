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
    /** Optional scope filter (glob patterns). Reviewer only looks at matching files. */
    scope: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    provider: "anthropic" | "openai" | "google";
    model: string;
    skill: string;
    name?: string | undefined;
    maxTokens?: number | undefined;
    scope?: string[] | undefined;
}, {
    provider: "anthropic" | "openai" | "google";
    model: string;
    skill: string;
    name?: string | undefined;
    maxTokens?: number | undefined;
    scope?: string[] | undefined;
}>;
export type ModelRef = z.infer<typeof ModelRef>;
export declare const ReviewerRef: z.ZodObject<{
    provider: z.ZodEnum<["anthropic", "openai", "google"]>;
    model: z.ZodString;
    skill: z.ZodString;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    scope: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
} & {
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    provider: "anthropic" | "openai" | "google";
    model: string;
    skill: string;
    name: string;
    maxTokens?: number | undefined;
    scope?: string[] | undefined;
}, {
    provider: "anthropic" | "openai" | "google";
    model: string;
    skill: string;
    name: string;
    maxTokens?: number | undefined;
    scope?: string[] | undefined;
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
}, "strip", z.ZodTypeAny, {
    mode: "sequential_rotation" | "parallel_aggregate";
    max_iterations: number;
    final_verification: "all_reviewers" | "first_reviewer" | "none";
}, {
    mode?: "sequential_rotation" | "parallel_aggregate" | undefined;
    max_iterations?: number | undefined;
    final_verification?: "all_reviewers" | "first_reviewer" | "none" | undefined;
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
        /** Optional scope filter (glob patterns). Reviewer only looks at matching files. */
        scope: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
        scope?: string[] | undefined;
    }, {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
        scope?: string[] | undefined;
    }>;
    reviewers: z.ZodArray<z.ZodObject<{
        provider: z.ZodEnum<["anthropic", "openai", "google"]>;
        model: z.ZodString;
        skill: z.ZodString;
        maxTokens: z.ZodOptional<z.ZodNumber>;
        scope: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    } & {
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name: string;
        maxTokens?: number | undefined;
        scope?: string[] | undefined;
    }, {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name: string;
        maxTokens?: number | undefined;
        scope?: string[] | undefined;
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
    }, "strip", z.ZodTypeAny, {
        mode: "sequential_rotation" | "parallel_aggregate";
        max_iterations: number;
        final_verification: "all_reviewers" | "first_reviewer" | "none";
    }, {
        mode?: "sequential_rotation" | "parallel_aggregate" | undefined;
        max_iterations?: number | undefined;
        final_verification?: "all_reviewers" | "first_reviewer" | "none" | undefined;
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
    review: {
        parallel: boolean;
    };
    fix: {
        mode: "sequential_rotation" | "parallel_aggregate";
        max_iterations: number;
        final_verification: "all_reviewers" | "first_reviewer" | "none";
    };
    writer: {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
        scope?: string[] | undefined;
    };
    reviewers: {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name: string;
        maxTokens?: number | undefined;
        scope?: string[] | undefined;
    }[];
    sast: {
        enabled: boolean;
        tools: ("semgrep" | "eslint" | "npm_audit")[];
        inject_into_reviewer_context: boolean;
    };
    gates: {
        block_on_new_critical: boolean;
        block_on_new_high: boolean;
        max_cost_usd: number;
        max_wall_time_minutes: number;
    };
    output: {
        report: string;
        findings: string;
        diff: string;
    };
}, {
    writer: {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name?: string | undefined;
        maxTokens?: number | undefined;
        scope?: string[] | undefined;
    };
    reviewers: {
        provider: "anthropic" | "openai" | "google";
        model: string;
        skill: string;
        name: string;
        maxTokens?: number | undefined;
        scope?: string[] | undefined;
    }[];
    review?: {
        parallel?: boolean | undefined;
    } | undefined;
    fix?: {
        mode?: "sequential_rotation" | "parallel_aggregate" | undefined;
        max_iterations?: number | undefined;
        final_verification?: "all_reviewers" | "first_reviewer" | "none" | undefined;
    } | undefined;
    sast?: {
        enabled?: boolean | undefined;
        tools?: ("semgrep" | "eslint" | "npm_audit")[] | undefined;
        inject_into_reviewer_context?: boolean | undefined;
    } | undefined;
    gates?: {
        block_on_new_critical?: boolean | undefined;
        block_on_new_high?: boolean | undefined;
        max_cost_usd?: number | undefined;
        max_wall_time_minutes?: number | undefined;
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
    ANTHROPIC_API_KEY?: string | undefined;
    OPENAI_API_KEY?: string | undefined;
    GOOGLE_API_KEY?: string | undefined;
    GITHUB_TOKEN?: string | undefined;
    GITHUB_ACTIONS?: string | undefined;
}, {
    ANTHROPIC_API_KEY?: string | undefined;
    OPENAI_API_KEY?: string | undefined;
    GOOGLE_API_KEY?: string | undefined;
    ANTHROPIC_MODE?: "api" | "cli" | undefined;
    OPENAI_MODE?: "api" | "cli" | undefined;
    GOOGLE_MODE?: "api" | "cli" | undefined;
    CLAUDE_CLI_BIN?: string | undefined;
    GEMINI_CLI_BIN?: string | undefined;
    GITHUB_TOKEN?: string | undefined;
    GITHUB_ACTIONS?: string | undefined;
}>;
export type Env = z.infer<typeof EnvSchema>;
//# sourceMappingURL=schema.d.ts.map