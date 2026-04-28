import { z } from 'zod';

export const Severity = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
export type Severity = z.infer<typeof Severity>;

export const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
};

/** A single vulnerability or concern reported by a reviewer. */
export const FindingSchema = z.object({
  id: z.string(), // e.g. "F-01"
  severity: Severity,
  cwe: z.string().optional(), // e.g. "CWE-306"
  owaspCategory: z.string().optional(), // e.g. "A01:2025"
  file: z.string(),
  lineStart: z.number().int().min(0),
  lineEnd: z.number().int().min(0),
  title: z.string(),
  description: z.string(),
  remediation: z.string().optional(),
  reportedBy: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type Finding = z.infer<typeof FindingSchema>;

export const SeverityBreakdownSchema = z.object({
  CRITICAL: z.number().int().default(0),
  HIGH: z.number().int().default(0),
  MEDIUM: z.number().int().default(0),
  LOW: z.number().int().default(0),
  INFO: z.number().int().default(0),
});
export type SeverityBreakdown = z.infer<typeof SeverityBreakdownSchema>;

/**
 * Condition-D-compatible evidence JSON. Field names match
 * secure-code-despite-ai/scanning/results/(tool)/(task)/(task)-conditionD-runN.json
 * exactly, so Condition F output plots directly against C/D baselines.
 */
export const EvidenceJsonSchema = z.object({
  task_id: z.string(),
  tool: z.string(), // e.g. "secure-review-cross-model"
  condition: z.string(), // e.g. "F"
  run: z.number().int(),
  timestamp: z.string(), // ISO-8601
  model_version: z.string(),
  source_condition: z.string().optional(),
  total_findings_initial: z.number().int(),
  findings_by_severity_initial: SeverityBreakdownSchema,
  total_findings_after_fix: z.number().int(),
  findings_by_severity_after_fix: SeverityBreakdownSchema,
  new_findings_introduced: z.number().int(),
  findings_resolved: z.number().int(),
  resolution_rate_pct: z.number(),
  semgrep_after_fix: z.number().int().default(0),
  eslint_after_fix: z.number().int().default(0),
  lines_of_code_fixed: z.number().int().default(0),
  review_report: z.string().optional(),
  rereview_report: z.string().optional(),
  session_id: z.string().optional(),
  generation_time_seconds: z.number().optional(),
  total_cost_usd: z.number().optional(),
  review_status: z.string(),
  failed_reviewers: z.array(z.string()),
  // Extended fields for multi-reviewer runs
  reviewers: z.array(z.string()).optional(),
  iterations: z.number().int().optional(),
  per_iteration: z
    .array(
      z.object({
        iteration: z.number().int(),
        reviewer: z.string(),
        findings_found: z.number().int(),
        findings_severity: SeverityBreakdownSchema.optional(),
        cost_usd: z.number().optional(),
      })
    )
    .optional(),
  notes: z.string().optional(),
});
export type EvidenceJson = z.infer<typeof EvidenceJsonSchema>;
