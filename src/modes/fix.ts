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
import { readSourceTree } from '../util/files.js';
import { log } from '../util/logger.js';

export interface FixModeInput {
  root: string;
  config: SecureReviewConfig;
  configDir: string;
  env: Env;
}

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
  totalCostUSD: number;
  totalDurationMs: number;
  verification?: ReviewerRunOutput[];
}

export async function runFixMode(input: FixModeInput): Promise<FixModeOutput> {
  const { root, config, configDir, env } = input;
  const start = Date.now();

  log.header(`Fix mode — ${root}`);
  log.info(
    `Rotation: ${config.fix.mode} · max ${config.fix.max_iterations} iterations · ${config.reviewers.length} reviewers`,
  );

  // Preload adapters + skills for all reviewers + the writer
  const reviewerInstances = await Promise.all(
    config.reviewers.map(async (r) => ({
      ref: r,
      adapter: getAdapter({ provider: r.provider, model: r.model }, env),
      skill: await loadSkill(resolveSkillPath(r.skill, configDir)),
    })),
  );
  const writer = {
    ref: config.writer,
    adapter: getAdapter({ provider: config.writer.provider, model: config.writer.model }, env),
    skill: await loadSkill(resolveSkillPath(config.writer.skill, configDir)),
  };

  // Initial scan — SAST + first-pass reviewer aggregation for "before" baseline
  const first = reviewerInstances[0];
  if (!first) throw new Error('At least one reviewer is required');
  const initialFiles = await readSourceTree(root);
  const initialSast = await runAllSast(root, config.sast);
  const initialReviewer = await runReviewer({
    reviewer: first.ref,
    adapter: first.adapter,
    skill: first.skill,
    files: initialFiles,
    priorFindings: config.sast.inject_into_reviewer_context ? initialSast.findings : undefined,
  });
  let currentFindings = aggregate([...initialReviewer.findings, ...initialSast.findings]);
  const initialFindings = currentFindings;

  const iterations: IterationRecord[] = [];
  let totalCost = initialReviewer.usage.costUSD;
  const allChangedFiles = new Set<string>();
  let gateBlocked = false;
  let gateReasons: string[] = [];

  log.info(`Initial findings: ${initialFindings.length} (${formatBreakdown(severityBreakdown(initialFindings))})`);

  for (let i = 0; i < config.fix.max_iterations; i += 1) {
    const reviewer = pickReviewer(reviewerInstances, i, config.fix.mode);
    log.header(`Iteration ${i + 1} — reviewer: ${reviewer.ref.name}`);

    const beforeFiles = await readSourceTree(root);
    const sastBeforeRun = await runAllSast(root, config.sast);

    // This iteration's reviewer findings (unless this is the first iteration,
    // in which case we already have them from the initial scan)
    let reviewerRun: ReviewerRunOutput;
    if (i === 0 && reviewer.ref.name === first.ref.name) {
      reviewerRun = initialReviewer;
    } else {
      reviewerRun = await runReviewer({
        reviewer: reviewer.ref,
        adapter: reviewer.adapter,
        skill: reviewer.skill,
        files: beforeFiles,
        priorFindings: config.sast.inject_into_reviewer_context ? sastBeforeRun.findings : undefined,
      });
      totalCost += reviewerRun.usage.costUSD;
    }

    const findingsBefore = aggregate([...reviewerRun.findings, ...sastBeforeRun.findings]);
    log.info(
      `  ${reviewer.ref.name} found ${reviewerRun.findings.length} + ${sastBeforeRun.findings.length} SAST = ${findingsBefore.length} aggregated`,
    );

    if (findingsBefore.length === 0) {
      log.success('  No findings to fix — loop complete.');
      iterations.push({
        iteration: i + 1,
        reviewer: reviewer.ref.name,
        reviewerRun,
        sastBefore: summarizeSast(sastBeforeRun),
        sastAfter: summarizeSast(sastBeforeRun),
        findingsBefore,
        findingsAfter: findingsBefore,
        newCritical: 0,
        resolved: 0,
        costUSD: reviewerRun.usage.costUSD,
      });
      currentFindings = findingsBefore;
      break;
    }

    // Writer applies fixes
    log.info(`  Writer (${writer.ref.provider}/${writer.ref.model}) applying fixes...`);
    const writerRun = await runWriter({
      writer: writer.ref,
      adapter: writer.adapter,
      skill: writer.skill,
      root,
      files: beforeFiles,
      findings: findingsBefore,
    });
    totalCost += writerRun.usage.costUSD;
    writerRun.filesChanged.forEach((f) => allChangedFiles.add(f));
    log.info(`  Writer changed ${writerRun.filesChanged.length} files ($${writerRun.usage.costUSD.toFixed(3)})`);

    // Rescan after fix
    const sastAfterRun = await runAllSast(root, config.sast);
    const afterFiles = await readSourceTree(root);
    const verifierRun = await runReviewer({
      reviewer: reviewer.ref,
      adapter: reviewer.adapter,
      skill: reviewer.skill,
      files: afterFiles,
      priorFindings: config.sast.inject_into_reviewer_context ? sastAfterRun.findings : undefined,
    });
    totalCost += verifierRun.usage.costUSD;

    const findingsAfter = aggregate([...verifierRun.findings, ...sastAfterRun.findings]);
    const diff = diffFindings(findingsBefore, findingsAfter);
    const newCritical = diff.introduced.filter((f) => f.severity === 'CRITICAL').length;

    log.info(
      `  After fix: ${findingsAfter.length} findings · resolved ${diff.resolved.length} · introduced ${diff.introduced.length} (${newCritical} CRITICAL)`,
    );

    iterations.push({
      iteration: i + 1,
      reviewer: reviewer.ref.name,
      reviewerRun,
      sastBefore: summarizeSast(sastBeforeRun),
      sastAfter: summarizeSast(sastAfterRun),
      writerRun,
      findingsBefore,
      findingsAfter,
      newCritical,
      resolved: diff.resolved.length,
      costUSD: reviewerRun.usage.costUSD + writerRun.usage.costUSD + verifierRun.usage.costUSD,
    });

    // Gates
    const decision = evaluateGates(
      {
        beforeFindings: findingsBefore,
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
      gateReasons = decision.reasons;
      currentFindings = findingsAfter;
      break;
    }

    currentFindings = findingsAfter;

    if (findingsAfter.length === 0) {
      log.success('  All findings resolved.');
      break;
    }
  }

  // Final verification pass — all reviewers re-review
  let verification: ReviewerRunOutput[] | undefined;
  if (config.fix.final_verification !== 'none') {
    log.header('Final verification');
    const finalFiles = await readSourceTree(root);
    const finalSast = await runAllSast(root, config.sast);
    const verifiers =
      config.fix.final_verification === 'all_reviewers' ? reviewerInstances : [first];
    verification = await Promise.all(
      verifiers.map((r) =>
        runReviewer({
          reviewer: r.ref,
          adapter: r.adapter,
          skill: r.skill,
          files: finalFiles,
          priorFindings: config.sast.inject_into_reviewer_context ? finalSast.findings : undefined,
        }),
      ),
    );
    for (const v of verification) totalCost += v.usage.costUSD;
    const combined = aggregate([...verification.flatMap((v) => v.findings), ...finalSast.findings]);
    log.info(`Verification by ${verifiers.length} reviewer(s): ${combined.length} findings remaining`);
    currentFindings = combined;
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

function formatBreakdown(b: SeverityBreakdown): string {
  return `CRIT=${b.CRITICAL} HIGH=${b.HIGH} MED=${b.MEDIUM} LOW=${b.LOW} INFO=${b.INFO}`;
}
