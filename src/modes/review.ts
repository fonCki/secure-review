import { getAdapter } from '../adapters/factory.js';
import type { Env, SecureReviewConfig } from '../config/schema.js';
import { loadSkill, resolveSkillPath } from '../config/load.js';
import { aggregate, severityBreakdown } from '../findings/aggregate.js';
import { applyBaseline, type Baseline } from '../findings/baseline.js';
import type { Finding, SeverityBreakdown } from '../findings/schema.js';
import { runReviewer, type ReviewerRunOutput } from '../roles/reviewer.js';
import { filterSastByPaths, runAllSast, type SastSummary } from '../sast/index.js';
import { normalizeFindingPaths, readSourceTree } from '../util/files.js';
import { log } from '../util/logger.js';
import { summarizeReviewHealth, type ReviewHealthStatus } from '../util/review-health.js';
import { spinner } from '../util/spinner.js';

export interface ReviewModeInput {
  root: string;
  config: SecureReviewConfig;
  configDir: string;
  env: Env;
  /** If set, only files whose relPath is in this set are reviewed (incremental mode). */
  only?: Set<string>;
  /** If set, findings whose fingerprint matches a baseline entry are suppressed. */
  baseline?: Baseline;
}

export interface ReviewModeOutput {
  findings: Finding[];
  breakdown: SeverityBreakdown;
  sast: SastSummary;
  perReviewer: ReviewerRunOutput[];
  reviewStatus: ReviewHealthStatus;
  failedReviewers: string[];
  succeededReviewers: string[];
  totalCostUSD: number;
  totalDurationMs: number;
  /** Findings suppressed by the baseline (already excluded from `findings`). */
  baselineSuppressed: Finding[];
}

export async function runReviewMode(input: ReviewModeInput): Promise<ReviewModeOutput> {
  const { root, config, configDir, env, only, baseline } = input;
  const started = Date.now();

  log.header(`Review mode — ${root}${only ? ` (incremental: ${only.size} file${only.size === 1 ? '' : 's'})` : ''}`);
  log.info(`Reviewers: ${config.reviewers.map((r) => r.name).join(', ')}`);

  // 1. Read source tree
  const files = await readSourceTree(root, 200_000, only);
  log.info(`Loaded ${files.length} source files`);

  // 2. Run SAST (treat its findings as additional "reviewers")
  let sast: SastSummary;
  if (config.sast.enabled) {
    const sastSpinner = spinner('Running SAST (semgrep + eslint + npm-audit)');
    sast = await runAllSast(root, config.sast);
    sastSpinner.succeed(`SAST: ${sast.findings.length} finding${sast.findings.length === 1 ? '' : 's'}`);
    logSastSummary(sast);
  } else {
    sast = await runAllSast(root, config.sast);
  }
  // Bug 9 (PR #3 audit): SAST tools (semgrep / eslint / npm-audit) scan the
  // FULL scan-root regardless of `--since`, so without this filter SAST
  // findings from files outside the incremental subset would leak into the
  // aggregated set. README claims `--since` restricts the whole pipeline.
  // Bug A1 (round-2 blind audit by Codex): always route through
  // filterSastByPaths when `only` is provided — its empty-set branch
  // correctly returns drop-all, so an empty `--since` ref scopes SAST to
  // nothing instead of leaking the full tree.
  if (only) {
    sast = filterSastByPaths(sast, only);
  }

  // 3. Build context for reviewers
  const sastContextFindings = config.sast.inject_into_reviewer_context ? sast.findings : undefined;

  // 4. Load skills + adapters + run reviewers (parallel if configured)
  const reviewerRuns = normalizeReviewerRuns(
    await runReviewers(config, configDir, env, files, sastContextFindings),
    root,
  );
  const health = summarizeReviewHealth(reviewerRuns);

  // 5. Merge all findings (AI + SAST) into one aggregated set
  const allFindings: Finding[] = [];
  for (const r of reviewerRuns) allFindings.push(...r.findings);
  allFindings.push(...sast.findings);
  const aggregated = aggregate(allFindings);

  // 6. Apply baseline (FP suppression). Suppressed findings are kept on the
  //    output for transparency but excluded from the headline `findings` set.
  const { kept, suppressed } = applyBaseline(aggregated, baseline);
  if (suppressed.length > 0) {
    log.info(`Baseline: ${suppressed.length} finding${suppressed.length === 1 ? '' : 's'} suppressed`);
  }

  const totalCost = reviewerRuns.reduce((s, r) => s + r.usage.costUSD, 0);

  return {
    findings: kept,
    breakdown: severityBreakdown(kept),
    sast,
    perReviewer: reviewerRuns,
    reviewStatus: health.reviewStatus,
    failedReviewers: health.failedReviewers,
    succeededReviewers: health.succeededReviewers,
    totalCostUSD: totalCost,
    totalDurationMs: Date.now() - started,
    baselineSuppressed: suppressed,
  };
}

async function runReviewers(
  config: SecureReviewConfig,
  configDir: string,
  env: Env,
  files: Awaited<ReturnType<typeof readSourceTree>>,
  priorFindings: Finding[] | undefined,
): Promise<ReviewerRunOutput[]> {
  const N = config.reviewers.length;
  const isParallel = config.review.parallel;
  let completed = 0;
  const sp = spinner(
    isParallel
      ? `Reviewers: 0/${N} done (running in parallel)`
      : `Reviewers: 0/${N} done (sequential)`,
  );
  const runOne = async (reviewer: SecureReviewConfig['reviewers'][number]): Promise<ReviewerRunOutput> => {
    const adapter = getAdapter({ provider: reviewer.provider, model: reviewer.model }, env);
    const skill = await loadSkill(resolveSkillPath(reviewer.skill, configDir));
    log.debug(`${reviewer.name} → ${reviewer.provider}/${reviewer.model} (${adapter.mode})`);
    const result = await runReviewer({ reviewer, adapter, skill, files, priorFindings });
    completed += 1;
    sp.update(
      `Reviewers: ${completed}/${N} done (last: ${reviewer.name} → ${result.status === 'failed' ? 'FAILED' : `${result.findings.length} findings`})`,
    );
    return result;
  };
  const results = isParallel
    ? await Promise.all(config.reviewers.map(runOne))
    : await sequential(config.reviewers, runOne);
  sp.succeed(`Reviewers complete: ${N} done`);
  for (const r of results) {
    const status = r.status === 'failed' ? 'FAILED' : `${r.findings.length} findings`;
    log.info(`  ${r.reviewer}: ${status} ($${r.usage.costUSD.toFixed(3)}, ${(r.durationMs / 1000).toFixed(1)}s)`);
  }
  return results;
}

async function sequential<T, R>(items: T[], runOne: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (const item of items) out.push(await runOne(item));
  return out;
}

function normalizeReviewerRuns(runs: ReviewerRunOutput[], root: string): ReviewerRunOutput[] {
  return runs.map((r) => ({
    ...r,
    findings: normalizeFindingPaths(r.findings, root),
  }));
}

function logSastSummary(s: SastSummary): void {
  const sgStatus = s.semgrep.ran ? `${s.semgrep.count} findings` : `skipped (${s.semgrep.error ?? 'not installed'})`;
  const esStatus = s.eslint.ran ? `${s.eslint.count} findings` : `skipped (${s.eslint.error ?? 'not installed'})`;
  const npStatus = s.npmAudit.ran ? `${s.npmAudit.count} findings` : `skipped (${s.npmAudit.error ?? 'not installed'})`;
  log.info(`SAST: semgrep=${sgStatus}, eslint=${esStatus}, npm-audit=${npStatus}`);
}
