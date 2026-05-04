import { getAdapter } from '../adapters/factory.js';
import type { Env, SecureReviewConfig } from '../config/schema.js';
import { loadSkill, resolveSkillPath } from '../config/load.js';
import { aggregate, severityBreakdown } from '../findings/aggregate.js';
import { applyBaseline, type Baseline } from '../findings/baseline.js';
import { diffFindings } from '../findings/diff.js';
import { FindingRegistry } from '../findings/identity.js';
import type { Finding, SeverityBreakdown } from '../findings/schema.js';
import { SEVERITY_ORDER } from '../findings/schema.js';
import { evaluateGates } from '../gates/evaluate.js';
import { runReviewer, type ReviewerRunOutput } from '../roles/reviewer.js';
import { runWriter, type WriterRunOutput } from '../roles/writer.js';
import { filterSastByPaths, runAllSast, type SastSummary } from '../sast/index.js';
import { normalizeFindingPaths, normalizeRelPath, readSourceTree, writeFileSafe } from '../util/files.js';
import type { FileContent } from '../util/files.js';
import { log } from '../util/logger.js';
import { summarizeReviewHealth, type ReviewHealthStatus } from '../util/review-health.js';
import { spinner } from '../util/spinner.js';
import { resolve } from 'node:path';
import { readFile, rm } from 'node:fs/promises';

export interface FixModeInput {
  root: string;
  config: SecureReviewConfig;
  configDir: string;
  env: Env;
  /** If set, only files whose relPath is in this set are reviewed (incremental mode). */
  only?: Set<string>;
  /** If set, findings whose fingerprint matches a baseline entry are suppressed. */
  baseline?: Baseline;
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
  resolvedFindings: Finding[];
  introducedFindings: Finding[];
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
  /** Findings suppressed by the baseline at any phase (initial + each iteration + final). */
  baselineSuppressed: Finding[];
}

// ---------------------------------------------------------------------------
// Improvement 3: Snapshot / restore helpers
// ---------------------------------------------------------------------------

/** Capture a snapshot of file contents keyed by relPath. */
export function snapshotFiles(files: FileContent[]): Map<string, string> {
  const snap = new Map<string, string>();
  for (const f of files) snap.set(normalizeRelPath(f.relPath), f.content);
  return snap;
}

/**
 * Augment a snapshot with on-disk content for any extra repo-relative paths
 * not already covered. Used to cover the gap between `beforeFiles` (which is
 * scoped by `--since`) and `allowedFiles` (which can include paths from
 * findings outside the incremental subset). Without this, a writer touching
 * a pre-existing file outside the snapshot would be misclassified as having
 * "created" the file at rollback time, and the rollback would `rm` it.
 *
 * Bug 3 (PR #3 audit). Reads each missing path from disk; silently skips
 * paths that don't exist (those are genuinely writer-created if the writer
 * later reports having written them).
 */
export async function augmentSnapshot(
  snapshot: Map<string, string>,
  root: string,
  extraRelPaths: Iterable<string>,
): Promise<void> {
  const rootAbs = resolve(root);
  for (const raw of extraRelPaths) {
    const relPath = normalizeRelPath(raw);
    if (snapshot.has(relPath)) continue;
    const abs = resolve(rootAbs, relPath);
    try {
      const content = await readFile(abs, 'utf8');
      snapshot.set(relPath, content);
    } catch {
      // Doesn't exist on disk → genuinely a writer-created path if it
      // appears in writerTouchedRelPaths later. Leave out of snapshot so
      // restoreSnapshot's deletion path can fire.
    }
  }
}

/** Options for {@link restoreSnapshot}. */
export type RestoreSnapshotOptions = {
  /**
   * Paths the writer reported touching this iteration (normalized repo-relative paths).
   * Any path listed here that is **not** in `snapshot` is treated as a file **created**
   * by the writer and is deleted on restore.
   *
   * When omitted, no paths are deleted — only snapshot entries are written back.
   * That avoids wiping files outside an incremental `--since` subset (the snapshot
   * map might only cover a fraction of the repo).
   */
  writerTouchedRelPaths?: string[];
};

/** Restore snapshotted files to disk using writeFileSafe. */
export async function restoreSnapshot(
  root: string,
  snapshot: Map<string, string>,
  options?: RestoreSnapshotOptions,
): Promise<void> {
  const rootAbs = resolve(root);
  const touched = options?.writerTouchedRelPaths;
  if (touched && touched.length > 0) {
    for (const raw of touched) {
      const relPath = normalizeRelPath(raw);
      if (snapshot.has(relPath)) continue;
      await rm(resolve(rootAbs, relPath), { force: true });
    }
  }
  for (const [relPath, content] of snapshot) {
    const target = resolve(rootAbs, relPath);
    await writeFileSafe(target, content);
  }
}

// ---------------------------------------------------------------------------
// Improvement 7: Confidence / severity filtering helper
// ---------------------------------------------------------------------------

/** Filter findings down to those that meet the configured thresholds. */
export function filterFindingsForWriter(
  findings: Finding[],
  minConfidence: number,
  minSeverityToFix: Finding['severity'],
): Finding[] {
  const minSeverityOrder = SEVERITY_ORDER[minSeverityToFix];
  return findings.filter((f) => {
    if (f.confidence < minConfidence) return false;
    if (SEVERITY_ORDER[f.severity] < minSeverityOrder) return false;
    return true;
  });
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
  const { root, config, configDir, env, only, baseline } = input;
  const start = Date.now();

  // Stable IDs across iterations: same bug → same `S-NNN` even when the
  // verifier reports it with a slightly different line/title each time.
  // Removes the "introduced is inflated by relabeling" failure mode.
  const registry = new FindingRegistry();
  const baselineSuppressedAll: Finding[] = [];
  const seenSuppressedFingerprints = new Set<string>();
  const collectSuppressed = (suppressed: Finding[]): void => {
    for (const f of suppressed) {
      const fp = `${f.file}::${Math.floor(f.lineStart / 10)}`;
      if (seenSuppressedFingerprints.has(fp)) continue;
      seenSuppressedFingerprints.add(fp);
      baselineSuppressedAll.push(f);
    }
  };

  log.header(`Fix mode — ${root}${only ? ` (incremental: ${only.size} file${only.size === 1 ? '' : 's'})` : ''}`);
  log.info(
    `Rotation: ${config.fix.mode} · max ${config.fix.max_iterations} iterations · ${config.reviewers.length} reviewers${baseline ? ` · baseline: ${baseline.entries.length} accepted` : ''}`,
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
  const initialFiles = await readSourceTree(root, 200_000, only);
  const sastSpinner = spinner('Initial scan: SAST (semgrep + eslint + npm-audit)');
  // Bug 9 (PR #3 audit): SAST tools have no native --since support, so we
  // run full-tree and post-filter to the incremental set. Without this,
  // SAST findings from outside the changed file set would (a) leak into
  // aggregation, breaking --since semantics, and (b) populate
  // `allowedFiles` with paths the writer might touch and rollback might
  // mistakenly delete (Bug 3). See `runFilteredSast` helper below.
  const initialSast = await runFilteredSast(root, config.sast, only);
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
  const initialAggregated = aggregate([
    ...initialReviewerRuns.flatMap((r) => r.findings),
    ...initialSast.findings,
  ]);
  // Suppress baseline-accepted findings BEFORE the writer ever sees them —
  // saves writer cost on issues the user has already triaged as known.
  const initialFiltered = applyBaseline(initialAggregated, baseline);
  collectSuppressed(initialFiltered.suppressed);
  if (initialFiltered.suppressed.length > 0) {
    log.info(
      `Baseline: ${initialFiltered.suppressed.length} initial finding${initialFiltered.suppressed.length === 1 ? '' : 's'} suppressed`,
    );
  }
  const initialFindings = registry.annotate(initialFiltered.kept);

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
  // Improvement 4: track finding counts for divergence detection
  // Initialize to initialFindings.length so the first iteration's increase counts as streak 1.
  let prevFindingCount = initialFindings.length;
  let divergenceStreak = 0;

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
      const beforeFiles = await readSourceTree(root, 200_000, only);
      // Improvement 3: snapshot files before writer runs so we can roll back
      const preWriterSnapshot = snapshotFiles(beforeFiles);
      const sastBeforeRun = await runFilteredSast(root, config.sast, only);
      const allowedFiles = new Set<string>([
        ...beforeFiles.map((f) => normalizeRelPath(f.relPath)),
        ...findingsToFix.map((f) => normalizeRelPath(f.file)),
      ]);
      // Bug 3 (PR #3 audit): in --since mode, beforeFiles is the incremental
      // subset but allowedFiles can include paths from findings outside the
      // subset (LLM reviewers can mention out-of-scope files even after
      // Bug 9's SAST post-filter). If the writer touches such a pre-existing
      // file and we later roll back, restoreSnapshot would mis-classify it
      // as "writer-created" and `rm` it. We pre-read every allowedFiles path
      // not in beforeFiles so the snapshot covers the full surface the
      // writer might touch. Paths that don't exist on disk are intentionally
      // skipped — those are genuinely writer-created if the writer reports
      // them later.
      await augmentSnapshot(preWriterSnapshot, root, allowedFiles);

      // Improvement 7: filter findings by confidence and severity thresholds
      const minConf = config.fix.min_confidence_to_fix ?? 0;
      const minSev = config.fix.min_severity_to_fix ?? 'INFO';
      const filteredFindingsToFix = filterFindingsForWriter(findingsToFix, minConf, minSev);
      const filteredOut = findingsToFix.length - filteredFindingsToFix.length;
      if (filteredOut > 0) {
        log.info(
          `  Filtered ${filteredOut} finding(s) from writer queue (min_confidence: ${minConf}, min_severity: ${minSev})`,
        );
      }

      let writerRun: WriterRunOutput | undefined;
      if (filteredFindingsToFix.length > 0) {
        const wSpinner = spinner(
          `Writer (${writer.ref.provider}/${writer.ref.model}) fixing ${filteredFindingsToFix.length} finding(s)`,
        );
        writerRun = await runWriter({
          writer: writer.ref,
          adapter: writer.adapter,
          skill: writer.skill,
          root,
          files: beforeFiles,
          findings: filteredFindingsToFix,
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
      const afterFiles = await readSourceTree(root, 200_000, only);
      const sastAfterRun = await runFilteredSast(root, config.sast, only);
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

      const findingsAfterAggregated = aggregate([...verifierRun.findings, ...sastAfterRun.findings]);
      const afterFiltered = applyBaseline(findingsAfterAggregated, baseline);
      collectSuppressed(afterFiltered.suppressed);
      const staticFindingsAfter = registry.annotate(afterFiltered.kept);

      const findingsAfter = staticFindingsAfter;
      const diff = diffFindings(findingsToFix, findingsAfter);
      const newCritical = diff.introduced.filter((f) => f.severity === 'CRITICAL').length;

      log.info(
        `  ${verifier.ref.name} sees ${findingsAfter.length} finding(s) post-fix · resolved ${diff.resolved.length} · introduced ${diff.introduced.length} (${newCritical} CRITICAL)`,
      );

      // Improvement 4: convergence detection — stop if findings grew 2 consecutive iters.
      // Bug 6 (PR #3 audit): the divergence check used to `break` HERE, before
      // gate evaluation. That meant a divergent iteration that ALSO introduced
      // new CRITICALs would exit the loop without firing `block_on_new_critical`
      // and without rolling back the writer's bad changes. We now compute the
      // streak, push the iteration ONCE, run gates (including rollback), and
      // only break at the END of the iteration if divergence triggered.
      const currentFindingCount = findingsAfter.length;
      let divergenceTriggered = false;
      if (currentFindingCount > prevFindingCount) {
        divergenceStreak += 1;
        if (divergenceStreak >= 2) divergenceTriggered = true;
      } else {
        divergenceStreak = 0;
      }
      prevFindingCount = currentFindingCount;

      iterations.push({
        iteration: i + 1,
        reviewer: verifier.ref.name,
        reviewerRun: verifierRun,
        sastBefore: summarizeSast(sastBeforeRun),
        sastAfter: summarizeSast(sastAfterRun),
        writerRun,
        findingsBefore: findingsToFix,
        findingsAfter,
        resolvedFindings: diff.resolved,
        introducedFindings: diff.introduced,
        newCritical,
        resolved: diff.resolved.length,
        costUSD: (writerRun?.usage.costUSD ?? 0) + verifierRun.usage.costUSD,
      });

      // Gates — run BEFORE divergence break so rollback + gate-blocked status
      // still apply to a divergent iteration that also tripped a gate.
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
        // Improvement 3: rollback if writer introduced new CRITICALs
        if (newCritical > 0 && writerRun && writerRun.filesChanged.length > 0) {
          log.warn('Writer introduced new CRITICAL(s) — rolling back to pre-iteration snapshot');
          await restoreSnapshot(root, preWriterSnapshot, {
            writerTouchedRelPaths: writerRun.filesChanged,
          });
          currentFindings = findingsToFix;
        } else {
          currentFindings = findingsAfter;
        }
        log.warn(`Gate triggered — stopping loop: ${decision.reasons.join('; ')}`);
        gateBlocked = true;
        gateReasons = mergeGateReasons(gateReasons, decision.reasons);
        break;
      }

      currentFindings = findingsAfter;

      if (divergenceTriggered) {
        log.warn(
          'Divergence detected (findings grew 2 consecutive iterations) — stopping loop early to prevent regression',
        );
        break;
      }

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
    const finalFiles = await readSourceTree(root, 200_000, only);
    const finalSast = await runFilteredSast(root, config.sast, only);
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
    const combinedAggregated = aggregate([
      ...verification.flatMap((v) => v.findings),
      ...finalSast.findings,
    ]);
    const combinedFiltered = applyBaseline(combinedAggregated, baseline);
    collectSuppressed(combinedFiltered.suppressed);
    const staticCombined = registry.annotate(combinedFiltered.kept);
    const combined = staticCombined;
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
    baselineSuppressed: baselineSuppressedAll,
  };
}

/**
 * Run SAST and (optionally) post-filter to an incremental file set. Used at
 * 4 sites in the fix loop (initial scan, sastBeforeRun, sastAfterRun, finalSast).
 * Bug 9 (PR #3 audit) — see filterSastByPaths in src/sast/index.ts.
 */
async function runFilteredSast(
  root: string,
  sastConfig: SecureReviewConfig['sast'],
  only: Set<string> | undefined,
): Promise<SastSummary> {
  const summary = await runAllSast(root, sastConfig);
  // Bug A1 (round-2 blind audit by Codex): when `only` is provided AND empty,
  // the user explicitly scoped to nothing. Pre-fix the `only.size > 0` guard
  // here short-circuited and returned the full-tree summary, contradicting
  // both `readSourceTree`'s and `filterSastByPaths`'s now-strict empty-set
  // semantics. Fix: if `only` is provided, route through filterSastByPaths
  // unconditionally — its empty-set branch already returns drop-all.
  if (only) return filterSastByPaths(summary, only);
  return summary;
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
