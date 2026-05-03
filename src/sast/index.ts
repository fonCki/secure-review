import type { SecureReviewConfig } from '../config/schema.js';
import type { Finding } from '../findings/schema.js';
import { normalizeFindingPaths } from '../util/files.js';
import { runEslint } from './eslint.js';
import { runNpmAudit } from './npm-audit.js';
import { runSemgrep } from './semgrep.js';

export interface SastSummary {
  findings: Finding[];
  semgrep: { ran: boolean; count: number; error?: string };
  eslint: { ran: boolean; count: number; error?: string };
  npmAudit: { ran: boolean; count: number; error?: string };
}

/**
 * Filter a SAST summary down to only findings whose `file` is in the given
 * set of scan-root-relative paths. Used by `--since` incremental mode in
 * review.ts and fix.ts to drop SAST findings outside the changed file set.
 *
 * SAST tools (semgrep / eslint / npm-audit) scan the entire scan root and
 * have no native --since support, so we run them full-tree and post-filter.
 * The per-tool counts in the summary are recomputed to match the filtered
 * findings so log output and JSON evidence stay consistent.
 *
 * Bug 9 (PR #3 audit).
 */
export function filterSastByPaths(summary: SastSummary, only: Set<string>): SastSummary {
  if (only.size === 0) return summary;
  const filtered = summary.findings.filter((f) => only.has(f.file));
  // Recompute per-tool counts from the filtered findings. We use the
  // `reportedBy` field which carries the source tool name (e.g., "semgrep").
  let semgrepCount = 0;
  let eslintCount = 0;
  let npmAuditCount = 0;
  for (const f of filtered) {
    if (f.reportedBy.includes('semgrep')) semgrepCount += 1;
    if (f.reportedBy.includes('eslint')) eslintCount += 1;
    if (f.reportedBy.includes('npm-audit') || f.reportedBy.includes('npm_audit')) npmAuditCount += 1;
  }
  return {
    findings: filtered,
    semgrep: { ...summary.semgrep, count: semgrepCount },
    eslint: { ...summary.eslint, count: eslintCount },
    npmAudit: { ...summary.npmAudit, count: npmAuditCount },
  };
}

export async function runAllSast(path: string, config: SecureReviewConfig['sast']): Promise<SastSummary> {
  const summary: SastSummary = {
    findings: [],
    semgrep: { ran: false, count: 0 },
    eslint: { ran: false, count: 0 },
    npmAudit: { ran: false, count: 0 },
  };
  if (!config.enabled) return summary;

  if (config.tools.includes('semgrep')) {
    const r = await runSemgrep(path);
    summary.semgrep = { ran: r.available, count: r.findings.length, error: r.error };
    summary.findings.push(...normalizeFindingPaths(r.findings, path));
  }
  if (config.tools.includes('eslint')) {
    const r = await runEslint(path);
    summary.eslint = { ran: r.available, count: r.findings.length, error: r.error };
    summary.findings.push(...normalizeFindingPaths(r.findings, path));
  }
  if (config.tools.includes('npm_audit')) {
    const r = await runNpmAudit(path);
    summary.npmAudit = { ran: r.available, count: r.findings.length, error: r.error };
    summary.findings.push(...normalizeFindingPaths(r.findings, path));
  }
  return summary;
}
