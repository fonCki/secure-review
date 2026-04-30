import type { Finding, SeverityBreakdown } from '../findings/schema.js';
import { SEVERITY_ORDER } from '../findings/schema.js';
import type { ReviewModeOutput } from '../modes/review.js';
import type { FixModeOutput } from '../modes/fix.js';
import { agreementCount } from '../findings/aggregate.js';

export function renderReviewReport(output: ReviewModeOutput): string {
  const parts: string[] = [];
  parts.push(`# Secure Review Report`);
  parts.push(`\nGenerated: ${new Date().toISOString()}`);
  parts.push(reviewStatusLine(output));
  parts.push(`\nTotal cost: $${output.totalCostUSD.toFixed(3)}`);
  parts.push(`Duration: ${(output.totalDurationMs / 1000).toFixed(1)}s\n`);

  parts.push(`## Summary\n`);
  parts.push(breakdownTable(output.breakdown));
  parts.push('');
  const suppressedCount = output.baselineSuppressed?.length ?? 0;
  parts.push(`Total findings: **${output.findings.length}**${suppressedCount > 0 ? ` (+${suppressedCount} suppressed by baseline)` : ''}\n`);

  parts.push(`## Per-reviewer\n`);
  parts.push('| Reviewer | Findings | Cost (USD) | Duration | Status |');
  parts.push('|---|---:|---:|---:|---|');
  for (const r of output.perReviewer) {
    parts.push(
      `| ${r.reviewer} | ${r.findings.length} | ${r.usage.costUSD.toFixed(3)} | ${(r.durationMs / 1000).toFixed(1)}s | ${r.error ? 'FAILED' : 'ok'} |`,
    );
  }
  parts.push('');

  parts.push(`## SAST\n`);
  parts.push('| Tool | Ran? | Findings | Note |');
  parts.push('|---|---|---:|---|');
  parts.push(row('semgrep', output.sast.semgrep));
  parts.push(row('eslint', output.sast.eslint));
  parts.push(row('npm-audit', output.sast.npmAudit));
  parts.push('');

  parts.push(`## Findings\n`);
  if (output.findings.length === 0) {
    parts.push('_No findings._');
  } else {
    const sorted = sortByAgreement(output.findings);
    for (const f of sorted) parts.push(renderFinding(f));
  }

  return parts.join('\n');
}

export function renderFixReport(output: FixModeOutput): string {
  const parts: string[] = [];
  parts.push(`# Secure Review — Fix Mode Report`);
  parts.push(`\nGenerated: ${new Date().toISOString()}`);
  parts.push(reviewStatusLine(output));
  parts.push(`Total cost: $${output.totalCostUSD.toFixed(3)}`);
  parts.push(`Duration: ${(output.totalDurationMs / 1000).toFixed(1)}s`);
  parts.push(`Gate blocked: ${output.gateBlocked ? 'YES' : 'no'}`);
  if (output.gateReasons.length) parts.push(`Reasons: ${output.gateReasons.join('; ')}`);
  parts.push('');

  parts.push(`## Before vs After\n`);
  parts.push('| Severity | Initial | Final | Δ |');
  parts.push('|---|---:|---:|---:|');
  for (const k of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const) {
    const d = output.finalBreakdown[k] - output.initialBreakdown[k];
    parts.push(`| ${k} | ${output.initialBreakdown[k]} | ${output.finalBreakdown[k]} | ${d > 0 ? '+' + d : d} |`);
  }
  const initialTotal = output.initialFindings.length;
  const finalTotal = output.finalFindings.length;
  parts.push(`| **Total** | **${initialTotal}** | **${finalTotal}** | **${finalTotal - initialTotal}** |`);
  parts.push('');
  const fixSuppressedCount = output.baselineSuppressed?.length ?? 0;
  if (fixSuppressedCount > 0) {
    parts.push(
      `> Baseline: ${fixSuppressedCount} accepted finding(s) suppressed at all phases (writer never saw them).`,
    );
    parts.push('');
  }

  parts.push(`## Iterations\n`);
  if (output.iterations.length === 0) {
    parts.push('_No iterations executed._');
  } else {
    parts.push('| # | Verifier | Findings In | Findings Out | Resolved | Introduced (CRITICAL) | Cost (USD) |');
    parts.push('|---:|---|---:|---:|---:|---:|---:|');
    for (const it of output.iterations) {
      const introduced = it.introducedFindings?.length ?? Math.max(0, it.findingsAfter.length - (it.findingsBefore.length - it.resolved));
      parts.push(
        `| ${it.iteration} | ${it.reviewer} | ${it.findingsBefore.length} | ${it.findingsAfter.length} | ${it.resolved} | ${introduced} (${it.newCritical}) | ${it.costUSD.toFixed(3)} |`,
      );
    }
    parts.push('');
    parts.push(
      '> _Findings In_ = what the writer addressed this iteration (union of initial readers for iter 1, previous verifier\'s audit for iter 2+). _Findings Out_ = what the rotating verifier saw after the writer ran.',
    );
    parts.push('');

    // Per-iteration finding detail (uses stable IDs so the same bug shows up
    // with the same `S-NNN` across iterations — see findings/identity.ts).
    for (const it of output.iterations) {
      const resolved = it.resolvedFindings ?? [];
      const introduced = it.introducedFindings ?? [];
      if (resolved.length === 0 && introduced.length === 0) continue;
      parts.push(`### Iteration ${it.iteration} detail\n`);
      if (resolved.length > 0) {
        parts.push(`**Resolved (${resolved.length}):**\n`);
        for (const f of resolved) parts.push(`- ${renderFindingDelta(f, 'resolved')}`);
        parts.push('');
      }
      if (introduced.length > 0) {
        parts.push(`**Introduced (${introduced.length}):**\n`);
        for (const f of introduced) parts.push(`- ${renderFindingDelta(f, 'introduced')}`);
        parts.push('');
      }
    }
  }
  parts.push('');

  if (output.filesChanged.length) {
    parts.push(`## Files Changed\n`);
    for (const f of output.filesChanged) parts.push(`- \`${f}\``);
    parts.push('');
  }

  parts.push(`## Remaining Findings\n`);
  if (output.finalFindings.length === 0) {
    parts.push('_All findings resolved._ 🎉');
  } else {
    const sorted = sortByAgreement(output.finalFindings);
    for (const f of sorted) parts.push(renderFinding(f));
  }

  return parts.join('\n');
}

function row(
  name: string,
  r: { ran: boolean; count: number; error?: string },
): string {
  return `| ${name} | ${r.ran ? '✅' : '⚠️'} | ${r.count} | ${r.error ?? ''} |`;
}

function reviewStatusLine(output: {
  reviewStatus: 'ok' | 'degraded' | 'failed';
  failedReviewers: string[];
}): string {
  if (output.reviewStatus === 'ok') return `**Status:** OK`;
  if (output.reviewStatus === 'degraded') {
    return `**Status:** DEGRADED — ${output.failedReviewers.length} reviewer(s) failed: ${output.failedReviewers.join(', ')}`;
  }
  return `**Status:** FAILED — all reviewers unavailable`;
}

function renderFinding(f: Finding): string {
  const reporters = f.reportedBy.join(', ');
  const tags = [f.cwe, f.owaspCategory].filter(Boolean).join(' · ');
  const count = agreementCount(f);
  const agreementBadge = count > 1 ? ` · ✅ confirmed by ${count} models` : '';
  const stableTag = f.stableId ? ` [${f.stableId}]` : '';
  return `
### ${f.id}${stableTag} · **${f.severity}** · ${f.title}${agreementBadge}

- **File:** \`${f.file}:${f.lineStart}-${f.lineEnd}\`
- **Tags:** ${tags || '—'}
- **Reported by:** ${reporters}  (confidence: ${(f.confidence * 100).toFixed(0)}%, agreement: ${count} model${count !== 1 ? 's' : ''})

${f.description}

${f.remediation ? `**Remediation:** ${f.remediation}` : ''}
`;
}

/** Compact one-line view for the per-iteration resolved/introduced detail block. */
function renderFindingDelta(f: Finding, kind: 'resolved' | 'introduced'): string {
  const id = f.stableId ? `\`${f.stableId}\` ` : '';
  const sev = kind === 'resolved' ? `~~${f.severity}~~` : `**${f.severity}**`;
  const tag = f.cwe ? ` (${f.cwe})` : '';
  return `${id}${sev} \`${f.file}:${f.lineStart}\` — ${f.title}${tag}`;
}

/** Sort findings by agreement count (desc), then severity (desc). */
function sortByAgreement(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const cntDiff = agreementCount(b) - agreementCount(a);
    if (cntDiff !== 0) return cntDiff;
    return SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
  });
}

function breakdownTable(b: SeverityBreakdown): string {
  const rows = ['| CRITICAL | HIGH | MEDIUM | LOW | INFO |', '|---:|---:|---:|---:|---:|'];
  rows.push(`| ${b.CRITICAL} | ${b.HIGH} | ${b.MEDIUM} | ${b.LOW} | ${b.INFO} |`);
  return rows.join('\n');
}
