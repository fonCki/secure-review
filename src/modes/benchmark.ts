import { getAdapter } from '../adapters/factory.js';
import type { Env, ModelRef, SecureReviewConfig } from '../config/schema.js';
import { loadSkill, resolveSkillPath } from '../config/load.js';
import { aggregate, severityBreakdown } from '../findings/aggregate.js';
import { diffFindings } from '../findings/diff.js';
import type { Finding } from '../findings/schema.js';
import { runReviewer } from '../roles/reviewer.js';
import { runWriter } from '../roles/writer.js';
import { runAllSast } from '../sast/index.js';
import { normalizeFindingPaths, normalizeRelPath, readSourceTree } from '../util/files.js';
import { log } from '../util/logger.js';
import { spinner } from '../util/spinner.js';
import { snapshotFiles, restoreSnapshot } from './fix.js';

export interface BenchmarkModeInput {
  root: string;
  config: SecureReviewConfig;
  configDir: string;
  env: Env;
}

export interface WriterBenchmarkResult {
  writerName: string;
  writerModel: string;
  filesChanged: number;
  findingsResolved: number;
  findingsIntroduced: number;
  costUSD: number;
  durationMs: number;
  error?: string;
}

export interface BenchmarkModeOutput {
  initialFindingsCount: number;
  results: WriterBenchmarkResult[];
  totalDurationMs: number;
}

/**
 * Benchmark mode: runs the initial scan to get the finding set, then for each
 * configured writer runs one fix iteration, measures outcomes, and restores
 * files to the original state between runs.
 */
export async function runBenchmarkMode(input: BenchmarkModeInput): Promise<BenchmarkModeOutput> {
  const { root, config, configDir, env } = input;
  const start = Date.now();

  log.header(`Benchmark mode — ${root}`);

  // Determine the list of writers to benchmark
  const writersToTest: ModelRef[] = config.writers && config.writers.length > 0
    ? config.writers
    : [config.writer];

  log.info(`Writers to benchmark: ${writersToTest.map((w) => w.model).join(', ')}`);
  log.info(`Reviewers: ${config.reviewers.map((r) => r.name).join(', ')}`);

  // Load reviewer instances
  const reviewerInstances = await Promise.all(
    config.reviewers.map(async (r) => ({
      ref: r,
      adapter: getAdapter({ provider: r.provider, model: r.model }, env),
      skill: await loadSkill(resolveSkillPath(r.skill, configDir)),
    })),
  );
  if (reviewerInstances.length === 0) throw new Error('At least one reviewer is required');
  const N = reviewerInstances.length;

  // 1) INITIAL SCAN — all reviewers + SAST
  const initialFiles = await readSourceTree(root);
  const originalSnapshot = snapshotFiles(initialFiles);

  const sastSpinner = spinner('Benchmark: initial SAST scan');
  const initialSast = await runAllSast(root, config.sast);
  sastSpinner.succeed(
    `Initial SAST: ${initialSast.findings.length} finding${initialSast.findings.length === 1 ? '' : 's'}`,
  );

  let completedReviewers = 0;
  const initSpinner = spinner(`Benchmark: initial scan — 0/${N} reviewer${N === 1 ? '' : 's'} done`);
  const initialReviewerRuns = await Promise.all(
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
        `Benchmark: initial scan — ${completedReviewers}/${N} reviewer${N === 1 ? '' : 's'} done`,
      );
      return {
        ...result,
        findings: normalizeFindingPaths(result.findings, root),
      };
    }),
  );
  initSpinner.succeed(`Initial scan complete`);

  const initialFindings: Finding[] = aggregate([
    ...initialReviewerRuns.flatMap((r) => r.findings),
    ...initialSast.findings,
  ]);
  log.info(`Initial findings: ${initialFindings.length} (${Object.entries(severityBreakdown(initialFindings)).map(([k, v]) => `${k}=${v}`).join(' ')})`);

  if (initialFindings.length === 0) {
    log.info('No findings to fix — benchmark will still run writer with empty queue.');
  }

  const allowedFiles = new Set<string>([
    ...initialFiles.map((f) => normalizeRelPath(f.relPath)),
    ...initialFindings.map((f) => normalizeRelPath(f.file)),
  ]);

  // 2) For each writer: run one fix iteration, measure, restore
  const results: WriterBenchmarkResult[] = [];

  for (const writerRef of writersToTest) {
    const writerName = writerRef.name ?? `${writerRef.provider}/${writerRef.model}`;
    log.header(`Benchmarking writer: ${writerName} (${writerRef.model})`);

    const writerAdapter = getAdapter({ provider: writerRef.provider, model: writerRef.model }, env);
    const writerSkill = await loadSkill(resolveSkillPath(writerRef.skill, configDir));

    const iterStart = Date.now();
    let filesChanged = 0;
    let findingsResolved = 0;
    let findingsIntroduced = 0;
    let costUSD = 0;
    let errorMsg: string | undefined;

    try {
      const wSpinner = spinner(`Writer ${writerName} fixing ${initialFindings.length} finding(s)`);
      const writerRun = await runWriter({
        writer: writerRef,
        adapter: writerAdapter,
        skill: writerSkill,
        root,
        files: initialFiles,
        findings: initialFindings,
        allowedFiles,
      });
      costUSD = writerRun.usage.costUSD;
      filesChanged = writerRun.filesChanged.length;

      if (writerRun.error) {
        wSpinner.fail(`Writer ${writerName} failed: ${writerRun.error}`);
        errorMsg = writerRun.error;
      } else {
        wSpinner.succeed(
          `Writer ${writerName} changed ${filesChanged} file(s) ($${costUSD.toFixed(3)})`,
        );

        // Re-scan with ALL reviewers in parallel — same as the initial scan —
        // so the outcome measurement matches the combined multi-model view.
        const postFiles = await readSourceTree(root);
        const postSast = await runAllSast(root, config.sast);
        const vSpinner = spinner(
          `Measuring outcomes with all ${N} reviewer${N === 1 ? '' : 's'} (combined view)`,
        );
        const verifierRuns = await Promise.all(
          reviewerInstances.map((r) =>
            runReviewer({
              reviewer: r.ref,
              adapter: r.adapter,
              skill: r.skill,
              files: postFiles,
              priorFindings: config.sast.inject_into_reviewer_context ? postSast.findings : undefined,
            }),
          ),
        );
        for (const vr of verifierRuns) costUSD += vr.usage.costUSD;
        const postFindings = aggregate([
          ...verifierRuns.flatMap((vr) => normalizeFindingPaths(vr.findings, root)),
          ...postSast.findings,
        ]);
        const diff = diffFindings(initialFindings, postFindings);
        findingsResolved = diff.resolved.length;
        findingsIntroduced = diff.introduced.length;
        vSpinner.succeed(
          `Verifier: resolved=${findingsResolved} introduced=${findingsIntroduced}`,
        );
      }
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      log.warn(`Writer ${writerName} threw an error: ${errorMsg}`);
    }

    results.push({
      writerName,
      writerModel: writerRef.model,
      filesChanged,
      findingsResolved,
      findingsIntroduced,
      costUSD,
      durationMs: Date.now() - iterStart,
      error: errorMsg,
    });

    // Restore original files before next writer run
    log.info(`Restoring original files before next writer run...`);
    await restoreSnapshot(root, originalSnapshot);
  }

  return {
    initialFindingsCount: initialFindings.length,
    results,
    totalDurationMs: Date.now() - start,
  };
}

/** Render the benchmark results as a markdown comparison table. */
export function renderBenchmarkReport(output: BenchmarkModeOutput): string {
  const parts: string[] = [];
  parts.push('# Secure Review — Benchmark Report');
  parts.push(`\nGenerated: ${new Date().toISOString()}`);
  parts.push(`\nInitial findings: **${output.initialFindingsCount}**`);
  parts.push(`Duration: ${(output.totalDurationMs / 1000).toFixed(1)}s\n`);

  parts.push('## Writer Comparison\n');
  parts.push('| Writer Model | Files Changed | Resolved | Introduced | Cost (USD) | Duration | Status |');
  parts.push('|---|---:|---:|---:|---:|---:|---|');

  for (const r of output.results) {
    const status = r.error ? `FAILED: ${r.error.slice(0, 60)}` : 'ok';
    parts.push(
      `| ${r.writerName} (${r.writerModel}) | ${r.filesChanged} | ${r.findingsResolved} | ${r.findingsIntroduced} | $${r.costUSD.toFixed(3)} | ${(r.durationMs / 1000).toFixed(1)}s | ${status} |`,
    );
  }

  parts.push('');
  parts.push(
    '> _Resolved_ = findings present before the writer that disappeared after. _Introduced_ = new findings that appeared after the writer ran.',
  );

  return parts.join('\n');
}
