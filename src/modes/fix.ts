import { getAdapter } from '../adapters/factory.js';
import type { Env, SecureReviewConfig } from '../config/schema.js';
import { loadSkill, resolveSkillPath } from '../config/load.js';
import { aggregate, severityBreakdown } from '../findings/aggregate.js';
import { diffFindings } from '../findings/diff.js';
import type { Finding, SeverityBreakdown } from '../findings/schema.js';
import { evaluateGates } from '../gates/evaluate.js';
import { runReviewer, type ReviewerRunOutput } from '../roles/reviewer.js';
import { runWriter, type WriterRunOutput } from '../roles/writer.js';
import { runAllSast } from '../sast/index.js';
import { normalizeFindingPaths, normalizeRelPath, readSourceTree } from '../util/files.js';
import { log } from '../util/logger.js';
import { summarizeReviewHealth, type ReviewHealthStatus } from '../util/review-health.js';
import { spinner } from '../util/spinner.js';

export interface FixModeInput {
  root: string;
  config: SecureReviewConfig;
  configDir: string;
  env: Env;
}

/**
 * One iteration of the rotating fix loop.
 *
 * Semantics (since 0.5.0):
 *   - `findingsBefore`  — what the writer was asked to fix this iteration.
 *                         For iter 1 this is the union of all initial readers + SAST.
 *                         For iter N+1 this is the previous verifier's audit output.
 *   - `reviewer`        — the VERIFIER for this iteration (the model that audits
 *                         the writer's output afterwards). Rotates each iteration.
 *   - `findingsAfter`   — what the verifier saw post-writer (becomes next iter's
 *                         `findingsBefore`).
 */
export interface IterationRecord {
  iteration: number;
  reviewer: string;
  reviewerRun: ReviewerRunOutput;
  sastBefore: { semgrep: number; eslint: number; npmAudit: number };
  sastAfter: { semgrep: number; eslint: number; npmAudit: number };
  writerRun?: WriterRunOutput;
  findingsBefore: Finding[];
  findingsAfter: Finding[];
  newCritical: number;
  resolved: number;
  costUSD: number;
}

export interface FixModeOutput {
  initialFindings: Finding[];
  finalFindings: Finding[];
  initialBreakdown: SeverityBreakdown;
  finalBreakdown: SeverityBreakdown;
  iterations: IterationRecord[];
  gateBlocked: boolean;
  gateReasons: string[];
  filesChanged: string[];
  reviewStatus: ReviewHealthStatus;
  failedReviewers: string[];
  succeededReviewers: string[];
  totalCostUSD: number;
  totalDurationMs: number;
  verification?: ReviewerRunOutput[];
}

/**
 * Cross-model rotating fix loop (Condition F, redesigned in 0.5.0).
 *
 * Workflow:
 *   1. INITIAL UNION SCAN — all readers in parallel + SAST. The aggregated
 *      union becomes the writer's first to-do list (no reader's blind spots
 *      get a free pass to slip past iteration 1).
 *   2. LOOP — for each iteration:
 *        a. Writer fixes the current to-do list.
 *        b. The next reader in rotation audits the writer's output (fresh eyes).
 *        c. That audit becomes the next to-do list.
 *      Stops only when a full rotation of readers all see clean (so a single
 *      lenient reader can't end the loop early), or when gates fire.
 *   3. FINAL VERIFICATION — all readers in parallel re-scan, in case the loop
 *      stopped on a single reader's "clean" (or gate-blocked) but other readers
 *      still see issues.
 */
export async function runFixMode(input: FixModeInput): Promise<FixModeOutput> {
  const { root, config, configDir, env } = input;
  const start = Date.now();

  log.header(`Fix mode — ${root}`);
  log.info(
    `Rotation: ${config.fix.mode} · max ${config.fix.max_iterations} iterations · ${config.reviewers.length} reviewers`,
  );

  const reviewerInstances = await Promise.all(
    config.reviewers.map(async (r) => ({
      ref: r,
      adapter: getAdapter({ provider: r.provider, model: r.model }, env),
      skill: await loadSkill(resolveSkillPath(r.skill, configDir)),
    })),
  );
  if (reviewerInstances.length === 0) throw new Error('At least one reviewer is required');
  const N = reviewerInstances.length;

  const writer = {
    ref: config.writer,
    adapter: getAdapter({ provider: config.writer.provider, model: config.writer.model }, env),
    skill: await loadSkill(resolveSkillPath(config.writer.skill, configDir)),
  };

  // 1) INITIAL UNION SCAN — all readers in parallel + SAST.
  const initialFiles = await readSourceTree(root);
  const sastSpinner = spinner('Initial scan: SAST (semgrep + eslint + npm-audit)');
  const initialSast = await runAllSast(root, config.sast);
  sastSpinner.succeed(
    `Initial SAST: ${initialSast.findings.length} finding${initialSast.findings.length === 1 ? '' : 's'}`,
  );

  // Live progress bar across the parallel reviewer calls.
  let completedReviewers = 0;
  const initSpinner = spinner(`Initial scan: 0/${N} reader${N === 1 ? '' : 's'} done`);
  const initialReviewerRuns = normalizeReviewerRuns(
    await Promise.all(
      reviewerInstances.map(async (r) => {
        const result = await runReviewer({
          reviewer: r.ref,
          adapter: r.adapter,
          skill: r.skill,
          files: initialFiles,
          priorFindings: config.sast.inject_into_reviewer_context ? initialSast.findings : undefined,
        });
        completedReviewers += 1;
        initSpinner.update(
          `Initial scan: ${completedReviewers}/${N} reader${N === 1 ? '' : 's'} done (last: ${r.ref.name} → ${result.status === 'failed' ? 'FAILED' : result.findings.length})`,
        );
        return result;
      }),
    ),
    root,
  );
  initSpinner.succeed(`Initial scan complete: ${N} reader${N === 1 ? '' : 's'}`);
  for (const r of initialReviewerRuns) {
    log.info(
      `  initial-scan ${r.reviewer}: ${r.error ? 'FAILED' : `${r.findings.length} findings`} ($${r.usage.costUSD.toFixed(3)}, ${(r.durationMs / 1000).toFixed(1)}s)`,
    );
  }
  const initialFindings = aggregate([
    ...initialReviewerRuns.flatMap((r) => r.findings),
    ...initialSast.findings,
  ]);

  // FIX (0.5.0): count ALL initial reviewer costs, not just the first.
  let totalCost = initialReviewerRuns.reduce((s, r) => s + r.usage.costUSD, 0);

  log.info(
    `Initial findings (union of ${N} reader${N === 1 ? '' : 's'} + SAST): ${initialFindings.length} (${formatBreakdown(severityBreakdown(initialFindings))})`,
  );

  // The writer's first to-do list IS the union — no reader's blind spots
  // get a free pass to skip iteration 1.
  let currentFindings = initialFindings;

  const iterations: IterationRecord[] = [];
  const allChangedFiles = new Set<string>();
  let gateBlocked = false;
  let gateReasons: string[] = [];
  let consecutiveCleanIters = 0;

  const initialGate = evaluateGates(
    {
      beforeFindings: [],
      afterFindings: initialFindings,
      cumulativeCostUSD: totalCost,
      elapsedMs: Date.now() - start,
      iteration: 0,
    },
    config.gates,
  );
  if (!initialGate.proceed) {
    log.warn(`Gate triggered after initial scan: ${initialGate.reasons.join('; ')}`);
    gateBlocked = true;
    gateReasons = mergeGateReasons(gateReasons, initialGate.reasons);
  }

  // 2) LOOP
  if (!gateBlocked) {
    for (let i = 0; i < config.fix.max_iterations; i += 1) {
      const verifier = pickReviewer(reviewerInstances, i, config.fix.mode);
      log.header(`Iteration ${i + 1} — verifier: ${verifier.ref.name}`);

    const findingsToFix = currentFindings;
    const beforeFiles = await readSourceTree(root);
    const sastBeforeRun = await runAllSast(root, config.sast);
    const allowedFiles = new Set<string>([
      ...beforeFiles.map((f) => normalizeRelPath(f.relPath)),
      ...findingsToFix.map((f) => normalizeRelPath(f.file)),
    ]);

    let writerRun: WriterRunOutput | undefined;
    if (findingsToFix.length > 0) {
      const wSpinner = spinner(
        `Writer (${writer.ref.provider}/${writer.ref.model}) fixing ${findingsToFix.length} finding(s)`,
      );
      writerRun = await runWriter({
        writer: writer.ref,
        adapter: writer.adapter,
        skill: writer.skill,
        root,
        files: beforeFiles,
        findings: findingsToFix,
        allowedFiles,
      });
      totalCost += writerRun.usage.costUSD;
      writerRun.filesChanged.forEach((f) => allChangedFiles.add(f));
      wSpinner.succeed(
        `Writer changed ${writerRun.filesChanged.length} file(s) ($${writerRun.usage.costUSD.toFixed(3)})`,
      );
    } else {
      log.info(`  Nothing to fix this iteration — ${verifier.ref.name} will confirm.`);
    }

    // Verifier audits whatever state we're in now (post-writer or unchanged).
    const afterFiles = await readSourceTree(root);
    const sastAfterRun = await runAllSast(root, config.sast);
    const vSpinner = spinner(`Verifier ${verifier.ref.name} auditing post-fix code`);
    const verifierRun = normalizeReviewerRun(
      await runReviewer({
        reviewer: verifier.ref,
        adapter: verifier.adapter,
        skill: verifier.skill,
        files: afterFiles,
        priorFindings: config.sast.inject_into_reviewer_context ? sastAfterRun.findings : undefined,
      }),
      root,
    );
    totalCost += verifierRun.usage.costUSD;
    vSpinner.succeed(
      `Verifier ${verifier.ref.name}: ${verifierRun.findings.length} finding${verifierRun.findings.length === 1 ? '' : 's'} ($${verifierRun.usage.costUSD.toFixed(3)})`,
    );

    const findingsAfter = aggregate([...verifierRun.findings, ...sastAfterRun.findings]);
    const diff = diffFindings(findingsToFix, findingsAfter);
    const newCritical = diff.introduced.filter((f) => f.severity === 'CRITICAL').length;

    log.info(
      `  ${verifier.ref.name} sees ${findingsAfter.length} finding(s) post-fix · resolved ${diff.resolved.length} · introduced ${diff.introduced.length} (${newCritical} CRITICAL)`,
    );

    iterations.push({
      iteration: i + 1,
      reviewer: verifier.ref.name,
      reviewerRun: verifierRun,
      sastBefore: summarizeSast(sastBeforeRun),
      sastAfter: summarizeSast(sastAfterRun),
      writerRun,
      findingsBefore: findingsToFix,
      findingsAfter,
      newCritical,
      resolved: diff.resolved.length,
      costUSD: (writerRun?.usage.costUSD ?? 0) + verifierRun.usage.costUSD,
    });

    // Gates
    const decision = evaluateGates(
      {
        beforeFindings: findingsToFix,
        afterFindings: findingsAfter,
        cumulativeCostUSD: totalCost,
        elapsedMs: Date.now() - start,
        iteration: i + 1,
      },
      config.gates,
    );
    if (!decision.proceed) {
      log.warn(`Gate triggered — stopping loop: ${decision.reasons.join('; ')}`);
      gateBlocked = true;
      gateReasons = mergeGateReasons(gateReasons, decision.reasons);
      currentFindings = findingsAfter;
      break;
    }

    currentFindings = findingsAfter;

    // Early exit: only when a FULL ROTATION of readers all see clean.
    // Prevents a single lenient reader from prematurely ending the loop.
    if (findingsAfter.length === 0) {
      consecutiveCleanIters += 1;
      if (consecutiveCleanIters >= N) {
        log.success(
          `Full rotation (${N} consecutive verifier${N === 1 ? '' : 's'}) reports clean — exiting early.`,
        );
        break;
      }
    } else {
      consecutiveCleanIters = 0;
    }
    }
  }

  // 3) FINAL VERIFICATION (parallel, configurable)
  let verification: ReviewerRunOutput[] | undefined;
  if (!gateBlocked && config.fix.final_verification !== 'none') {
    const preFinalGate = evaluateGates(
      {
        beforeFindings: currentFindings,
        afterFindings: currentFindings,
        cumulativeCostUSD: totalCost,
        elapsedMs: Date.now() - start,
        iteration: iterations.length,
      },
      config.gates,
    );
    if (!preFinalGate.proceed) {
      log.warn(`Gate triggered before final verification: ${preFinalGate.reasons.join('; ')}`);
      gateBlocked = true;
      gateReasons = mergeGateReasons(gateReasons, preFinalGate.reasons);
    }
  }
  if (!gateBlocked && config.fix.final_verification !== 'none') {
    log.header('Final verification');
    const finalFiles = await readSourceTree(root);
    const finalSast = await runAllSast(root, config.sast);
    const verifiers =
      config.fix.final_verification === 'all_reviewers'
        ? reviewerInstances
        : [reviewerInstances[0]!];
    let completedFinal = 0;
    const finalSpinner = spinner(
      `Final verification: 0/${verifiers.length} reader${verifiers.length === 1 ? '' : 's'} done`,
    );
    verification = normalizeReviewerRuns(
      await Promise.all(
        verifiers.map(async (r) => {
          const result = await runReviewer({
            reviewer: r.ref,
            adapter: r.adapter,
            skill: r.skill,
            files: finalFiles,
            priorFindings: config.sast.inject_into_reviewer_context ? finalSast.findings : undefined,
          });
          completedFinal += 1;
          finalSpinner.update(
            `Final verification: ${completedFinal}/${verifiers.length} reader${verifiers.length === 1 ? '' : 's'} done (last: ${r.ref.name} → ${result.status === 'failed' ? 'FAILED' : result.findings.length})`,
          );
          return result;
        }),
      ),
      root,
    );
    finalSpinner.succeed(`Final verification complete: ${verifiers.length} reader${verifiers.length === 1 ? '' : 's'}`);
    for (const v of verification) totalCost += v.usage.costUSD;
    const combined = aggregate([
      ...verification.flatMap((v) => v.findings),
      ...finalSast.findings,
    ]);
    log.info(`Verification by ${verifiers.length} reviewer(s): ${combined.length} findings remaining`);
    const postFinalGate = evaluateGates(
      {
        beforeFindings: currentFindings,
        afterFindings: combined,
        cumulativeCostUSD: totalCost,
        elapsedMs: Date.now() - start,
        iteration: iterations.length + 1,
      },
      config.gates,
    );
    if (!postFinalGate.proceed) {
      log.warn(`Gate triggered after final verification: ${postFinalGate.reasons.join('; ')}`);
      gateBlocked = true;
      gateReasons = mergeGateReasons(gateReasons, postFinalGate.reasons);
    }
    currentFindings = combined;
  }

  const verificationRuns = verification ?? [];
  const terminalVerifierRuns =
    verificationRuns.length > 0
      ? verificationRuns
      : config.fix.final_verification === 'none' && iterations.length > 0
        ? [iterations[iterations.length - 1]!.reviewerRun]
        : [];
  const healthRuns = [
    ...initialReviewerRuns,
    ...iterations.map((it) => it.reviewerRun),
    ...verificationRuns,
  ];
  const health = summarizeReviewHealth(healthRuns);
  if (terminalVerifierRuns.some((run) => run.status === 'failed')) {
    health.reviewStatus = 'failed';
  }

  return {
    initialFindings,
    finalFindings: currentFindings,
    initialBreakdown: severityBreakdown(initialFindings),
    finalBreakdown: severityBreakdown(currentFindings),
    iterations,
    gateBlocked,
    gateReasons,
    filesChanged: Array.from(allChangedFiles),
    reviewStatus: health.reviewStatus,
    failedReviewers: health.failedReviewers,
    succeededReviewers: health.succeededReviewers,
    totalCostUSD: totalCost,
    totalDurationMs: Date.now() - start,
    verification,
  };
}

function pickReviewer<T>(reviewers: T[], iteration: number, mode: SecureReviewConfig['fix']['mode']): T {
  if (reviewers.length === 0) throw new Error('No reviewers configured');
  if (mode === 'parallel_aggregate') return reviewers[0] as T;
  return reviewers[iteration % reviewers.length] as T;
}

function summarizeSast(s: Awaited<ReturnType<typeof runAllSast>>): {
  semgrep: number;
  eslint: number;
  npmAudit: number;
} {
  return {
    semgrep: s.semgrep.count,
    eslint: s.eslint.count,
    npmAudit: s.npmAudit.count,
  };
}

function normalizeReviewerRun(run: ReviewerRunOutput, root: string): ReviewerRunOutput {
  return {
    ...run,
    findings: normalizeFindingPaths(run.findings, root),
  };
}

function normalizeReviewerRuns(runs: ReviewerRunOutput[], root: string): ReviewerRunOutput[] {
  return runs.map((r) => normalizeReviewerRun(r, root));
}

function mergeGateReasons(existing: string[], next: string[]): string[] {
  return Array.from(new Set([...existing, ...next]));
}

function formatBreakdown(b: SeverityBreakdown): string {
  return `CRIT=${b.CRITICAL} HIGH=${b.HIGH} MED=${b.MEDIUM} LOW=${b.LOW} INFO=${b.INFO}`;
}
