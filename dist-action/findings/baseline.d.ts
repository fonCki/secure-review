import { z } from 'zod';
import type { Finding } from './schema.js';
/**
 * Default file name for a baseline. `secure-review review` and
 * `secure-review fix` will auto-load this if it exists in the scan root,
 * unless `--no-baseline` is passed.
 */
export declare const DEFAULT_BASELINE_FILENAME = ".secure-review-baseline.json";
/** Stored entry per accepted finding. */
export declare const BaselineEntrySchema: z.ZodObject<{
    fingerprint: z.ZodString;
    /** Snapshot of human-readable fields when accepted, for documentation. */
    file: z.ZodOptional<z.ZodString>;
    lineStart: z.ZodOptional<z.ZodNumber>;
    title: z.ZodOptional<z.ZodString>;
    cwe: z.ZodOptional<z.ZodString>;
    severity: z.ZodOptional<z.ZodString>;
    /** Optional rationale: why this finding is accepted (TP-but-tolerated, FP, etc.). */
    reason: z.ZodOptional<z.ZodString>;
    /** ISO-8601 timestamp of when this entry was added. */
    acceptedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    fingerprint: string;
    file?: string | undefined;
    lineStart?: number | undefined;
    title?: string | undefined;
    cwe?: string | undefined;
    severity?: string | undefined;
    reason?: string | undefined;
    acceptedAt?: string | undefined;
}, {
    fingerprint: string;
    file?: string | undefined;
    lineStart?: number | undefined;
    title?: string | undefined;
    cwe?: string | undefined;
    severity?: string | undefined;
    reason?: string | undefined;
    acceptedAt?: string | undefined;
}>;
export type BaselineEntry = z.infer<typeof BaselineEntrySchema>;
export declare const BaselineSchema: z.ZodObject<{
    schemaVersion: z.ZodDefault<z.ZodLiteral<1>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    entries: z.ZodDefault<z.ZodArray<z.ZodObject<{
        fingerprint: z.ZodString;
        /** Snapshot of human-readable fields when accepted, for documentation. */
        file: z.ZodOptional<z.ZodString>;
        lineStart: z.ZodOptional<z.ZodNumber>;
        title: z.ZodOptional<z.ZodString>;
        cwe: z.ZodOptional<z.ZodString>;
        severity: z.ZodOptional<z.ZodString>;
        /** Optional rationale: why this finding is accepted (TP-but-tolerated, FP, etc.). */
        reason: z.ZodOptional<z.ZodString>;
        /** ISO-8601 timestamp of when this entry was added. */
        acceptedAt: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        fingerprint: string;
        file?: string | undefined;
        lineStart?: number | undefined;
        title?: string | undefined;
        cwe?: string | undefined;
        severity?: string | undefined;
        reason?: string | undefined;
        acceptedAt?: string | undefined;
    }, {
        fingerprint: string;
        file?: string | undefined;
        lineStart?: number | undefined;
        title?: string | undefined;
        cwe?: string | undefined;
        severity?: string | undefined;
        reason?: string | undefined;
        acceptedAt?: string | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    entries: {
        fingerprint: string;
        file?: string | undefined;
        lineStart?: number | undefined;
        title?: string | undefined;
        cwe?: string | undefined;
        severity?: string | undefined;
        reason?: string | undefined;
        acceptedAt?: string | undefined;
    }[];
    schemaVersion: 1;
    createdAt: string;
    updatedAt: string;
}, {
    createdAt: string;
    updatedAt: string;
    entries?: {
        fingerprint: string;
        file?: string | undefined;
        lineStart?: number | undefined;
        title?: string | undefined;
        cwe?: string | undefined;
        severity?: string | undefined;
        reason?: string | undefined;
        acceptedAt?: string | undefined;
    }[] | undefined;
    schemaVersion?: 1 | undefined;
}>;
export type Baseline = z.infer<typeof BaselineSchema>;
export interface BaselineFilterResult {
    /** Findings that did NOT match any baseline entry. */
    kept: Finding[];
    /** Findings that DID match — i.e. were suppressed. */
    suppressed: Finding[];
}
/** Apply a baseline to a list of findings. Pure function; no I/O. */
export declare function applyBaseline(findings: Finding[], baseline: Baseline | undefined): BaselineFilterResult;
/** Build a baseline document containing every supplied finding. */
export declare function baselineFromFindings(findings: Finding[], reason?: string): Baseline;
/**
 * Merge new findings into an existing baseline. Existing entries
 * (matched by fingerprint) keep their original `reason`/`acceptedAt`;
 * new fingerprints are appended.
 */
export declare function mergeBaseline(existing: Baseline, findings: Finding[], reason?: string): Baseline;
/** Read and validate a baseline file. Returns `undefined` if the file does not exist. */
export declare function loadBaseline(path: string): Promise<Baseline | undefined>;
/** Write a baseline file (creating parent dirs as needed). */
export declare function saveBaseline(path: string, baseline: Baseline): Promise<void>;
//# sourceMappingURL=baseline.d.ts.map