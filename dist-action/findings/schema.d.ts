import { z } from 'zod';
export declare const Severity: z.ZodEnum<["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]>;
export type Severity = z.infer<typeof Severity>;
export declare const SEVERITY_ORDER: Record<Severity, number>;
/** A single vulnerability or concern reported by a reviewer. */
export declare const FindingSchema: z.ZodObject<{
    id: z.ZodString;
    /**
     * Stable identity assigned by the session-wide `FindingRegistry` (e.g. "S-001").
     * Same bug → same `stableId` across fix-loop iterations, even if the verifier
     * reports it with a slightly different line or title. Optional: only populated
     * by callers that have a registry (currently `runFixMode`).
     */
    stableId: z.ZodOptional<z.ZodString>;
    severity: z.ZodEnum<["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]>;
    cwe: z.ZodOptional<z.ZodString>;
    owaspCategory: z.ZodOptional<z.ZodString>;
    file: z.ZodString;
    lineStart: z.ZodNumber;
    lineEnd: z.ZodNumber;
    title: z.ZodString;
    description: z.ZodString;
    remediation: z.ZodOptional<z.ZodString>;
    reportedBy: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    confidence: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    file: string;
    lineStart: number;
    title: string;
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
    id: string;
    lineEnd: number;
    description: string;
    reportedBy: string[];
    confidence: number;
    cwe?: string | undefined;
    stableId?: string | undefined;
    owaspCategory?: string | undefined;
    remediation?: string | undefined;
}, {
    file: string;
    lineStart: number;
    title: string;
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
    id: string;
    lineEnd: number;
    description: string;
    cwe?: string | undefined;
    stableId?: string | undefined;
    owaspCategory?: string | undefined;
    remediation?: string | undefined;
    reportedBy?: string[] | undefined;
    confidence?: number | undefined;
}>;
export type Finding = z.infer<typeof FindingSchema>;
export declare const SeverityBreakdownSchema: z.ZodObject<{
    CRITICAL: z.ZodDefault<z.ZodNumber>;
    HIGH: z.ZodDefault<z.ZodNumber>;
    MEDIUM: z.ZodDefault<z.ZodNumber>;
    LOW: z.ZodDefault<z.ZodNumber>;
    INFO: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
    INFO: number;
}, {
    CRITICAL?: number | undefined;
    HIGH?: number | undefined;
    MEDIUM?: number | undefined;
    LOW?: number | undefined;
    INFO?: number | undefined;
}>;
export type SeverityBreakdown = z.infer<typeof SeverityBreakdownSchema>;
/**
 * Condition-D-compatible evidence JSON. Field names match
 * secure-code-despite-ai/scanning/results/(tool)/(task)/(task)-conditionD-runN.json
 * exactly, so Condition F output plots directly against C/D baselines.
 */
export declare const EvidenceJsonSchema: z.ZodObject<{
    task_id: z.ZodString;
    tool: z.ZodString;
    /**
     * Version of the secure-review package that produced this evidence.
     * Read from package.json at runtime. Used for reproducibility — old vs new
     * runs are distinguishable even when other fields are identical.
     */
    tool_version: z.ZodOptional<z.ZodString>;
    /**
     * Identifier for the finding-fingerprint / dedup algorithm in use when this
     * evidence was produced. Different algorithm = different `total_findings_*`
     * counts for the same input. See `findings/identity.ts` for the constant.
     */
    fingerprint_algorithm: z.ZodOptional<z.ZodString>;
    condition: z.ZodString;
    run: z.ZodNumber;
    timestamp: z.ZodString;
    model_version: z.ZodString;
    source_condition: z.ZodOptional<z.ZodString>;
    total_findings_initial: z.ZodNumber;
    findings_by_severity_initial: z.ZodObject<{
        CRITICAL: z.ZodDefault<z.ZodNumber>;
        HIGH: z.ZodDefault<z.ZodNumber>;
        MEDIUM: z.ZodDefault<z.ZodNumber>;
        LOW: z.ZodDefault<z.ZodNumber>;
        INFO: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        CRITICAL: number;
        HIGH: number;
        MEDIUM: number;
        LOW: number;
        INFO: number;
    }, {
        CRITICAL?: number | undefined;
        HIGH?: number | undefined;
        MEDIUM?: number | undefined;
        LOW?: number | undefined;
        INFO?: number | undefined;
    }>;
    total_findings_after_fix: z.ZodNumber;
    findings_by_severity_after_fix: z.ZodObject<{
        CRITICAL: z.ZodDefault<z.ZodNumber>;
        HIGH: z.ZodDefault<z.ZodNumber>;
        MEDIUM: z.ZodDefault<z.ZodNumber>;
        LOW: z.ZodDefault<z.ZodNumber>;
        INFO: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        CRITICAL: number;
        HIGH: number;
        MEDIUM: number;
        LOW: number;
        INFO: number;
    }, {
        CRITICAL?: number | undefined;
        HIGH?: number | undefined;
        MEDIUM?: number | undefined;
        LOW?: number | undefined;
        INFO?: number | undefined;
    }>;
    new_findings_introduced: z.ZodNumber;
    findings_resolved: z.ZodNumber;
    resolution_rate_pct: z.ZodNumber;
    semgrep_after_fix: z.ZodDefault<z.ZodNumber>;
    eslint_after_fix: z.ZodDefault<z.ZodNumber>;
    lines_of_code_fixed: z.ZodDefault<z.ZodNumber>;
    review_report: z.ZodOptional<z.ZodString>;
    rereview_report: z.ZodOptional<z.ZodString>;
    session_id: z.ZodOptional<z.ZodString>;
    generation_time_seconds: z.ZodOptional<z.ZodNumber>;
    total_cost_usd: z.ZodOptional<z.ZodNumber>;
    review_status: z.ZodString;
    failed_reviewers: z.ZodArray<z.ZodString, "many">;
    /**
     * Aggregated findings included for downstream tooling that needs the actual
     * finding objects (e.g. `secure-review baseline reports/review-*.json`).
     * Review mode writes the current review findings; fix mode writes final
     * remaining findings after the loop.
     */
    findings: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        /**
         * Stable identity assigned by the session-wide `FindingRegistry` (e.g. "S-001").
         * Same bug → same `stableId` across fix-loop iterations, even if the verifier
         * reports it with a slightly different line or title. Optional: only populated
         * by callers that have a registry (currently `runFixMode`).
         */
        stableId: z.ZodOptional<z.ZodString>;
        severity: z.ZodEnum<["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]>;
        cwe: z.ZodOptional<z.ZodString>;
        owaspCategory: z.ZodOptional<z.ZodString>;
        file: z.ZodString;
        lineStart: z.ZodNumber;
        lineEnd: z.ZodNumber;
        title: z.ZodString;
        description: z.ZodString;
        remediation: z.ZodOptional<z.ZodString>;
        reportedBy: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        confidence: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        file: string;
        lineStart: number;
        title: string;
        severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
        id: string;
        lineEnd: number;
        description: string;
        reportedBy: string[];
        confidence: number;
        cwe?: string | undefined;
        stableId?: string | undefined;
        owaspCategory?: string | undefined;
        remediation?: string | undefined;
    }, {
        file: string;
        lineStart: number;
        title: string;
        severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
        id: string;
        lineEnd: number;
        description: string;
        cwe?: string | undefined;
        stableId?: string | undefined;
        owaspCategory?: string | undefined;
        remediation?: string | undefined;
        reportedBy?: string[] | undefined;
        confidence?: number | undefined;
    }>, "many">>;
    reviewers: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    iterations: z.ZodOptional<z.ZodNumber>;
    per_iteration: z.ZodOptional<z.ZodArray<z.ZodObject<{
        iteration: z.ZodNumber;
        reviewer: z.ZodString;
        findings_found: z.ZodNumber;
        findings_severity: z.ZodOptional<z.ZodObject<{
            CRITICAL: z.ZodDefault<z.ZodNumber>;
            HIGH: z.ZodDefault<z.ZodNumber>;
            MEDIUM: z.ZodDefault<z.ZodNumber>;
            LOW: z.ZodDefault<z.ZodNumber>;
            INFO: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            CRITICAL: number;
            HIGH: number;
            MEDIUM: number;
            LOW: number;
            INFO: number;
        }, {
            CRITICAL?: number | undefined;
            HIGH?: number | undefined;
            MEDIUM?: number | undefined;
            LOW?: number | undefined;
            INFO?: number | undefined;
        }>>;
        cost_usd: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        iteration: number;
        reviewer: string;
        findings_found: number;
        findings_severity?: {
            CRITICAL: number;
            HIGH: number;
            MEDIUM: number;
            LOW: number;
            INFO: number;
        } | undefined;
        cost_usd?: number | undefined;
    }, {
        iteration: number;
        reviewer: string;
        findings_found: number;
        findings_severity?: {
            CRITICAL?: number | undefined;
            HIGH?: number | undefined;
            MEDIUM?: number | undefined;
            LOW?: number | undefined;
            INFO?: number | undefined;
        } | undefined;
        cost_usd?: number | undefined;
    }>, "many">>;
    notes: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    task_id: string;
    tool: string;
    condition: string;
    run: number;
    timestamp: string;
    model_version: string;
    total_findings_initial: number;
    findings_by_severity_initial: {
        CRITICAL: number;
        HIGH: number;
        MEDIUM: number;
        LOW: number;
        INFO: number;
    };
    total_findings_after_fix: number;
    findings_by_severity_after_fix: {
        CRITICAL: number;
        HIGH: number;
        MEDIUM: number;
        LOW: number;
        INFO: number;
    };
    new_findings_introduced: number;
    findings_resolved: number;
    resolution_rate_pct: number;
    semgrep_after_fix: number;
    eslint_after_fix: number;
    lines_of_code_fixed: number;
    review_status: string;
    failed_reviewers: string[];
    reviewers?: string[] | undefined;
    findings?: {
        file: string;
        lineStart: number;
        title: string;
        severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
        id: string;
        lineEnd: number;
        description: string;
        reportedBy: string[];
        confidence: number;
        cwe?: string | undefined;
        stableId?: string | undefined;
        owaspCategory?: string | undefined;
        remediation?: string | undefined;
    }[] | undefined;
    tool_version?: string | undefined;
    fingerprint_algorithm?: string | undefined;
    source_condition?: string | undefined;
    review_report?: string | undefined;
    rereview_report?: string | undefined;
    session_id?: string | undefined;
    generation_time_seconds?: number | undefined;
    total_cost_usd?: number | undefined;
    iterations?: number | undefined;
    per_iteration?: {
        iteration: number;
        reviewer: string;
        findings_found: number;
        findings_severity?: {
            CRITICAL: number;
            HIGH: number;
            MEDIUM: number;
            LOW: number;
            INFO: number;
        } | undefined;
        cost_usd?: number | undefined;
    }[] | undefined;
    notes?: string | undefined;
}, {
    task_id: string;
    tool: string;
    condition: string;
    run: number;
    timestamp: string;
    model_version: string;
    total_findings_initial: number;
    findings_by_severity_initial: {
        CRITICAL?: number | undefined;
        HIGH?: number | undefined;
        MEDIUM?: number | undefined;
        LOW?: number | undefined;
        INFO?: number | undefined;
    };
    total_findings_after_fix: number;
    findings_by_severity_after_fix: {
        CRITICAL?: number | undefined;
        HIGH?: number | undefined;
        MEDIUM?: number | undefined;
        LOW?: number | undefined;
        INFO?: number | undefined;
    };
    new_findings_introduced: number;
    findings_resolved: number;
    resolution_rate_pct: number;
    review_status: string;
    failed_reviewers: string[];
    reviewers?: string[] | undefined;
    findings?: {
        file: string;
        lineStart: number;
        title: string;
        severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
        id: string;
        lineEnd: number;
        description: string;
        cwe?: string | undefined;
        stableId?: string | undefined;
        owaspCategory?: string | undefined;
        remediation?: string | undefined;
        reportedBy?: string[] | undefined;
        confidence?: number | undefined;
    }[] | undefined;
    tool_version?: string | undefined;
    fingerprint_algorithm?: string | undefined;
    source_condition?: string | undefined;
    semgrep_after_fix?: number | undefined;
    eslint_after_fix?: number | undefined;
    lines_of_code_fixed?: number | undefined;
    review_report?: string | undefined;
    rereview_report?: string | undefined;
    session_id?: string | undefined;
    generation_time_seconds?: number | undefined;
    total_cost_usd?: number | undefined;
    iterations?: number | undefined;
    per_iteration?: {
        iteration: number;
        reviewer: string;
        findings_found: number;
        findings_severity?: {
            CRITICAL?: number | undefined;
            HIGH?: number | undefined;
            MEDIUM?: number | undefined;
            LOW?: number | undefined;
            INFO?: number | undefined;
        } | undefined;
        cost_usd?: number | undefined;
    }[] | undefined;
    notes?: string | undefined;
}>;
export type EvidenceJson = z.infer<typeof EvidenceJsonSchema>;
//# sourceMappingURL=schema.d.ts.map