import { severityBreakdown } from '../findings/aggregate.js';
import { diffFindings } from '../findings/diff.js';
import type { EvidenceJson } from '../findings/schema.js';
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
export function renderReviewEvidence(out: ReviewModeOutput, opts: JsonReportOptions): EvidenceJson {
  return {
    task_id: opts.taskId,
    tool: 'secure-review',
    condition: 'F-review',
    run: opts.run,
    timestamp: new Date().toISOString(),
    model_version: opts.modelVersion,
    source_condition: opts.sourceCondition,
    total_findings_initial: out.findings.length,
    findings_by_severity_initial: out.breakdown,
    total_findings_after_fix: out.findings.length,
    findings_by_severity_after_fix: out.breakdown,
    new_findings_introduced: 0,
    findings_resolved: 0,
    resolution_rate_pct: 0,
    semgrep_after_fix: out.sast.semgrep.count,
    eslint_after_fix: out.sast.eslint.count,
    lines_of_code_fixed: 0,
    review_report: `Review-only run — no fixes applied.`,
    session_id: opts.sessionId,
    generation_time_seconds: out.totalDurationMs / 1000,
    total_cost_usd: out.totalCostUSD,
    reviewers: opts.reviewerNames,
    iterations: 0,
  };
}

export function renderFixEvidence(out: FixModeOutput, opts: JsonReportOptions): EvidenceJson {
  const diff = diffFindings(out.initialFindings, out.finalFindings);
  const resolvedCount = diff.resolved.length;
  const resolutionRate =
    out.initialFindings.length === 0 ? 0 : (resolvedCount / out.initialFindings.length) * 100;

  return {
    task_id: opts.taskId,
    tool: 'secure-review',
    condition: 'F-fix',
    run: opts.run,
    timestamp: new Date().toISOString(),
    model_version: opts.modelVersion,
    source_condition: opts.sourceCondition,
    total_findings_initial: out.initialFindings.length,
    findings_by_severity_initial: out.initialBreakdown,
    total_findings_after_fix: out.finalFindings.length,
    findings_by_severity_after_fix: out.finalBreakdown,
    new_findings_introduced: diff.introduced.length,
    findings_resolved: resolvedCount,
    resolution_rate_pct: Math.round(resolutionRate * 100) / 100,
    semgrep_after_fix: out.iterations.at(-1)?.sastAfter.semgrep ?? 0,
    eslint_after_fix: out.iterations.at(-1)?.sastAfter.eslint ?? 0,
    lines_of_code_fixed: 0,
    review_report: summarizeInitial(out),
    rereview_report: summarizeFinal(out),
    session_id: opts.sessionId,
    generation_time_seconds: out.totalDurationMs / 1000,
    total_cost_usd: out.totalCostUSD,
    reviewers: opts.reviewerNames,
    iterations: out.iterations.length,
    per_iteration: out.iterations.map((it) => ({
      iteration: it.iteration,
      reviewer: it.reviewer,
      findings_found: it.findingsBefore.length,
      findings_severity: severityBreakdown(it.findingsBefore),
      cost_usd: Math.round(it.costUSD * 1000) / 1000,
    })),
    notes: out.gateBlocked ? `Gate blocked: ${out.gateReasons.join('; ')}` : undefined,
  };
}

function summarizeInitial(out: FixModeOutput): string {
  const b = out.initialBreakdown;
  return `Initial: ${out.initialFindings.length} findings — CRIT=${b.CRITICAL} HIGH=${b.HIGH} MED=${b.MEDIUM} LOW=${b.LOW} INFO=${b.INFO}`;
}

function summarizeFinal(out: FixModeOutput): string {
  const b = out.finalBreakdown;
  return `Final: ${out.finalFindings.length} findings — CRIT=${b.CRITICAL} HIGH=${b.HIGH} MED=${b.MEDIUM} LOW=${b.LOW} INFO=${b.INFO}`;
}
