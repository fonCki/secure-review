import { severityBreakdown } from '../findings/aggregate.js';
import { diffFindings } from '../findings/diff.js';
import type { EvidenceJson } from '../findings/schema.js';
import type { AttackAiModeOutput } from '../modes/attack-ai.js';
import type { AttackModeOutput } from '../modes/attack.js';
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
    review_status: out.reviewStatus,
    failed_reviewers: out.failedReviewers,
    findings: out.findings,
    reviewers: opts.reviewerNames,
    iterations: 0,
  };
}

export function renderFixEvidence(
  out: FixModeOutput,
  opts: JsonReportOptions,
): EvidenceJson & {
  runtime_attacks?: Array<{
    phase: string;
    target_url: string;
    pages: number;
    hypotheses: number;
    probes_total: number;
    probes_confirmed: number;
    findings: number;
    cost_usd: number;
  }>;
  initial_runtime_findings?: number;
  final_runtime_findings?: number;
} {
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
    review_status: out.reviewStatus,
    failed_reviewers: out.failedReviewers,
    findings: out.finalFindings,
    reviewers: opts.reviewerNames,
    iterations: out.iterations.length,
    per_iteration: out.iterations.map((it) => ({
      iteration: it.iteration,
      reviewer: it.reviewer,
      // 0.5.0+ semantics:
      //   verifier        — the model that audited this iteration's writer output
      //   findings_in     — what the writer was asked to fix this iteration
      //   findings_out    — what the verifier saw after the writer ran
      //   findings_found  — kept as alias for findings_in for backward compat
      verifier: it.reviewer,
      findings_in: it.findingsBefore.length,
      findings_out: it.findingsAfter.length,
      findings_resolved: it.resolved,
      findings_found: it.findingsBefore.length,
      findings_severity: severityBreakdown(it.findingsBefore),
      cost_usd: Math.round(it.costUSD * 1000) / 1000,
      runtime_findings: it.runtimeFindings?.length,
      runtime_attack_phase: it.runtimeAttackPhase,
    })),
    notes: out.gateBlocked ? `Gate blocked: ${out.gateReasons.join('; ')}` : undefined,
    runtime_attacks: out.runtimeAttacks?.map((phase) => ({
      phase: phase.phase,
      target_url: phase.output.targetUrl,
      pages: phase.output.pages.length,
      hypotheses: phase.output.hypotheses.length,
      probes_total: phase.output.probes.length,
      probes_confirmed: phase.output.probes.filter((p) => p.confirmed).length,
      findings: phase.output.findings.length,
      cost_usd: Math.round(phase.output.totalCostUSD * 1000) / 1000,
    })),
    initial_runtime_findings: out.initialRuntimeFindings?.length,
    final_runtime_findings: out.finalRuntimeFindings?.length,
  };
}

export function renderAttackEvidence(out: AttackModeOutput, opts: JsonReportOptions): EvidenceJson & {
  target_url: string;
  checks: AttackModeOutput['checks'];
  runtime_findings: AttackModeOutput['findings'];
  gate_blocked: boolean;
  gate_reasons: string[];
} {
  return {
    task_id: opts.taskId,
    tool: 'secure-review',
    condition: 'F-attack',
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
    semgrep_after_fix: 0,
    eslint_after_fix: 0,
    lines_of_code_fixed: 0,
    review_report: `Runtime attack run against ${out.targetUrl}`,
    session_id: opts.sessionId,
    generation_time_seconds: out.totalDurationMs / 1000,
    total_cost_usd: 0,
    review_status: 'ok',
    failed_reviewers: [],
    findings: out.findings,
    reviewers: opts.reviewerNames,
    iterations: 0,
    notes: out.gateBlocked ? `Gate blocked: ${out.gateReasons.join('; ')}` : undefined,
    target_url: out.targetUrl,
    checks: out.checks,
    runtime_findings: out.findings,
    gate_blocked: out.gateBlocked,
    gate_reasons: out.gateReasons,
  };
}

export function renderAttackAiEvidence(out: AttackAiModeOutput, opts: JsonReportOptions): EvidenceJson & {
  target_url: string;
  crawled_pages: AttackAiModeOutput['pages'];
  hypotheses: AttackAiModeOutput['hypotheses'];
  probes: AttackAiModeOutput['probes'];
  runtime_findings: AttackAiModeOutput['findings'];
  gate_blocked: boolean;
  gate_reasons: string[];
  limits: AttackAiModeOutput['limits'];
} {
  return {
    task_id: opts.taskId,
    tool: 'secure-review',
    condition: 'F-attack-ai',
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
    semgrep_after_fix: 0,
    eslint_after_fix: 0,
    lines_of_code_fixed: 0,
    review_report: `AI attack simulation against ${out.targetUrl}`,
    session_id: opts.sessionId,
    generation_time_seconds: out.totalDurationMs / 1000,
    total_cost_usd: out.totalCostUSD,
    review_status: 'ok',
    failed_reviewers: [],
    findings: out.findings,
    reviewers: opts.reviewerNames,
    iterations: 0,
    notes: out.gateBlocked ? `Gate blocked: ${out.gateReasons.join('; ')}` : undefined,
    target_url: out.targetUrl,
    crawled_pages: out.pages,
    hypotheses: out.hypotheses,
    probes: out.probes,
    runtime_findings: out.findings,
    gate_blocked: out.gateBlocked,
    gate_reasons: out.gateReasons,
    limits: out.limits,
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
