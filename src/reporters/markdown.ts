import type { Finding, SeverityBreakdown } from '../findings/schema.js';
import type { ReviewModeOutput } from '../modes/review.js';
import type { FixModeOutput } from '../modes/fix.js';

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
  parts.push(`Total findings: **${output.findings.length}**\n`);

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
    for (const f of output.findings) parts.push(renderFinding(f));
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

  parts.push(`## Iterations\n`);
  if (output.iterations.length === 0) {
    parts.push('_No iterations executed._');
  } else {
    parts.push('| # | Verifier | Findings In | Findings Out | Resolved | Introduced (CRITICAL) | Cost (USD) |');
    parts.push('|---:|---|---:|---:|---:|---:|---:|');
    for (const it of output.iterations) {
      const introduced = it.findingsAfter.length - (it.findingsBefore.length - it.resolved);
      parts.push(
        `| ${it.iteration} | ${it.reviewer} | ${it.findingsBefore.length} | ${it.findingsAfter.length} | ${it.resolved} | ${Math.max(0, introduced)} (${it.newCritical}) | ${it.costUSD.toFixed(3)} |`,
      );
    }
    parts.push('');
    parts.push(
      '> _Findings In_ = what the writer addressed this iteration (union of initial readers for iter 1, previous verifier\'s audit for iter 2+). _Findings Out_ = what the rotating verifier saw after the writer ran.',
    );
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
    for (const f of output.finalFindings) parts.push(renderFinding(f));
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
  return `
### ${f.id} · **${f.severity}** · ${f.title}

- **File:** \`${f.file}:${f.lineStart}-${f.lineEnd}\`
- **Tags:** ${tags || '—'}
- **Reported by:** ${reporters}  (confidence: ${(f.confidence * 100).toFixed(0)}%)

${f.description}

${f.remediation ? `**Remediation:** ${f.remediation}` : ''}
`;
}

function breakdownTable(b: SeverityBreakdown): string {
  const rows = ['| CRITICAL | HIGH | MEDIUM | LOW | INFO |', '|---:|---:|---:|---:|---:|'];
  rows.push(`| ${b.CRITICAL} | ${b.HIGH} | ${b.MEDIUM} | ${b.LOW} | ${b.INFO} |`);
  return rows.join('\n');
}
