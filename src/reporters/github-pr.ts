import { Octokit } from '@octokit/rest';
import type { Finding } from '../findings/schema.js';
import type { ReviewModeOutput } from '../modes/review.js';
import { log } from '../util/logger.js';

export interface PrPostOptions {
  owner: string;
  repo: string;
  prNumber: number;
  commitSha: string;
  token: string;
  /**
   * Map of changed-file path → Set of new-file line numbers that are valid
   * anchor points for a PR review comment (i.e. lines that appear in the
   * diff hunks, either added or context). GitHub's pulls/{n}/reviews endpoint
   * refuses comments on any line outside this set with 422 "Line could not
   * be resolved" — so we must filter findings before posting.
   */
  commentableLines: Map<string, Set<number>>;
}

export interface PrPostResult {
  inlineCount: number;
  summaryOnlyCount: number;
  criticalOnDiff: number;
}

/**
 * Posts the aggregated findings as a single GitHub PR review.
 *
 * Findings that land on a line present in the PR diff become line-anchored
 * inline comments. Findings in changed files but on lines outside the diff
 * (i.e. pre-existing issues in files the PR touches elsewhere) are listed
 * in the summary body instead of being posted inline — if we tried to post
 * them inline, GitHub would reject the whole review with 422 and the tool
 * would crash.
 *
 * Findings in files the PR doesn't touch at all are dropped (noise).
 */
export async function postPrReview(
  output: ReviewModeOutput,
  opts: PrPostOptions,
): Promise<PrPostResult> {
  const octokit = new Octokit({ auth: opts.token });

  const inDiff: Finding[] = [];
  const outOfDiffInTouchedFiles: Finding[] = [];
  let droppedOutsideTouchedFiles = 0;

  for (const f of output.findings) {
    const lineSet = opts.commentableLines.get(f.file);
    if (!lineSet) {
      droppedOutsideTouchedFiles++;
      continue;
    }
    // Try the starting line first, then each line in the reported range,
    // so a finding that spans across a hunk boundary can still anchor on
    // a commentable line rather than get pushed to the summary.
    const anchorLine = pickAnchorLine(f, lineSet);
    if (anchorLine !== null) {
      inDiff.push({ ...f, lineStart: anchorLine });
    } else {
      outOfDiffInTouchedFiles.push(f);
    }
  }

  const body = buildSummary(output, {
    inlineCount: inDiff.length,
    outOfDiffInTouchedFiles,
    droppedOutsideTouchedFiles,
  });

  const comments = inDiff.map((f) => ({
    path: f.file,
    line: Math.max(1, f.lineStart),
    side: 'RIGHT' as const,
    body: renderComment(f),
  }));

  const reviewParams: Parameters<typeof octokit.pulls.createReview>[0] = {
    owner: opts.owner,
    repo: opts.repo,
    pull_number: opts.prNumber,
    commit_id: opts.commitSha,
    event: 'COMMENT',
    body,
  };
  if (comments.length > 0) reviewParams.comments = comments;

  await octokit.pulls.createReview(reviewParams);

  if (inDiff.length > 0) {
    log.success(`Posted ${inDiff.length} inline comment(s) to ${opts.owner}/${opts.repo}#${opts.prNumber}`);
  }
  if (outOfDiffInTouchedFiles.length > 0) {
    log.info(
      `${outOfDiffInTouchedFiles.length} pre-existing finding(s) on changed files moved to summary (lines outside PR diff)`,
    );
  }
  if (droppedOutsideTouchedFiles > 0) {
    log.info(`${droppedOutsideTouchedFiles} finding(s) in untouched files omitted`);
  }

  const criticalOnDiff = inDiff.filter((f) => f.severity === 'CRITICAL').length;
  return {
    inlineCount: inDiff.length,
    summaryOnlyCount: outOfDiffInTouchedFiles.length,
    criticalOnDiff,
  };
}

function pickAnchorLine(f: Finding, lineSet: Set<number>): number | null {
  if (lineSet.has(f.lineStart)) return f.lineStart;
  // Scan the reported range if we have a meaningful lineEnd
  const end = Math.max(f.lineStart, f.lineEnd ?? f.lineStart);
  for (let n = f.lineStart + 1; n <= end; n++) {
    if (lineSet.has(n)) return n;
  }
  return null;
}

interface SummaryContext {
  inlineCount: number;
  outOfDiffInTouchedFiles: Finding[];
  droppedOutsideTouchedFiles: number;
}

function buildSummary(output: ReviewModeOutput, ctx: SummaryContext): string {
  const b = output.breakdown;
  const reviewerList = output.perReviewer
    .map((r) => `- **${r.reviewer}**: ${r.findings.length} findings${r.error ? ` (⚠️ ${r.error})` : ''}`)
    .join('\n');
  const sastList = `- **semgrep**: ${output.sast.semgrep.ran ? output.sast.semgrep.count : 'skipped'}
- **eslint**: ${output.sast.eslint.ran ? output.sast.eslint.count : 'skipped'}
- **npm-audit**: ${output.sast.npmAudit.ran ? output.sast.npmAudit.count : 'skipped'}`;

  const preexistingBlock =
    ctx.outOfDiffInTouchedFiles.length > 0
      ? `\n### Pre-existing findings on changed files (not in diff)\n\n${ctx.outOfDiffInTouchedFiles
          .map(
            (f) =>
              `- **${f.severity}** · \`${f.file}:${f.lineStart}\` · ${f.title}${
                f.cwe ? ` _(${f.cwe})_` : ''
              }`,
          )
          .join('\n')}\n`
      : '';

  const droppedNote =
    ctx.droppedOutsideTouchedFiles > 0
      ? `\n> ${ctx.droppedOutsideTouchedFiles} finding(s) in files not modified by this PR were omitted.\n`
      : '';

  return `## 🔒 Secure Review — multi-model security audit

**Findings:** ${output.findings.length} (${ctx.inlineCount} inline${
    ctx.outOfDiffInTouchedFiles.length > 0 ? `, ${ctx.outOfDiffInTouchedFiles.length} pre-existing` : ''
  })  ·  **Cost:** $${output.totalCostUSD.toFixed(3)}  ·  **Duration:** ${(output.totalDurationMs / 1000).toFixed(1)}s

| CRITICAL | HIGH | MEDIUM | LOW | INFO |
|---:|---:|---:|---:|---:|
| ${b.CRITICAL} | ${b.HIGH} | ${b.MEDIUM} | ${b.LOW} | ${b.INFO} |

### Reviewers
${reviewerList}

### SAST
${sastList}
${preexistingBlock}${droppedNote}
<sub>Generated by [secure-review](https://github.com/fonCki/secure-review) · multi-model security review for AI-generated code</sub>`;
}

function renderComment(f: Finding): string {
  const tags = [f.cwe, f.owaspCategory].filter(Boolean).join(' · ');
  const reporters = f.reportedBy.join(', ');
  const confidence = (f.confidence * 100).toFixed(0);
  const confidenceBadge =
    f.reportedBy.length >= 2 ? `🎯 ${confidence}% (${f.reportedBy.length} reviewers agree)` : `${confidence}%`;
  return `**${f.severity}** · ${f.title} ${tags ? `_(${tags})_` : ''}

${f.description}

${f.remediation ? `**Fix:** ${f.remediation}\n\n` : ''}---
<sub>reported by: ${reporters} · confidence: ${confidenceBadge}</sub>`;
}
