import { getAdapter } from '../adapters/factory.js';
import type { Env, SecureReviewConfig } from '../config/schema.js';
import { loadSkill, resolveSkillPath } from '../config/load.js';
import { aggregate, agreementCount } from '../findings/aggregate.js';
import { diffFindings } from '../findings/diff.js';
import type { Finding } from '../findings/schema.js';
import { runReviewer } from '../roles/reviewer.js';
import { runAllSast } from '../sast/index.js';
import { normalizeFindingPaths, readSourceTree } from '../util/files.js';
import { log } from '../util/logger.js';
import { spinner } from '../util/spinner.js';

export interface ReviewerStrategyResult {
  name: string;
  findings: Finding[];
  costUSD: number;
  durationMs: number;
  status: 'ok' | 'failed';
  missedVsCombined: Finding[];   // in combined but not in this single-model run
  uniqueToThis: Finding[];       // found only by this model, not by any other single model
}

export interface ReviewerBenchmarkOutput {
  root: string;
  singleResults: ReviewerStrategyResult[];
  combinedFindings: Finding[];
  combinedCostUSD: number;
  totalDurationMs: number;
}

/**
 * Reviewer benchmark: runs each reviewer individually, then compares against
 * the combined multi-model result. Shows what each single model misses and
 * what the combined approach adds — empirical evidence for the multi-model design.
 */
export async function runReviewerBenchmark(input: {
  root: string;
  config: SecureReviewConfig;
  configDir: string;
  env: Env;
}): Promise<ReviewerBenchmarkOutput> {
  const { root, config, configDir, env } = input;
  const start = Date.now();

  log.header(`Reviewer benchmark — ${root}`);
  log.info(`Comparing ${config.reviewers.length} individual reviewers vs combined multi-model`);

  const files = await readSourceTree(root);
  log.info(`Loaded ${files.length} source files`);

  const sastSpinner = spinner('Running SAST');
  const sast = await runAllSast(root, config.sast);
  sastSpinner.succeed(`SAST: ${sast.findings.length} findings`);
  const sastFindings = sast.findings;
  const priorFindings = config.sast.inject_into_reviewer_context ? sastFindings : undefined;

  // Load all reviewer instances
  const instances = await Promise.all(
    config.reviewers.map(async (r) => ({
      ref: r,
      adapter: getAdapter({ provider: r.provider, model: r.model }, env),
      skill: await loadSkill(resolveSkillPath(r.skill, configDir)),
    })),
  );

  // Run all reviewers in parallel (we need their raw outputs separately)
  const sp = spinner(`Running ${instances.length} reviewers in parallel`);
  const rawRuns = await Promise.all(
    instances.map(async (inst) => {
      const result = await runReviewer({
        reviewer: inst.ref,
        adapter: inst.adapter,
        skill: inst.skill,
        files,
        priorFindings,
      });
      return { inst, result };
    }),
  );
  sp.succeed(`All ${instances.length} reviewers done`);

  // Combined = aggregate of all reviewers + SAST (the full multi-model result)
  const allRawFindings = rawRuns.flatMap(({ result }) =>
    normalizeFindingPaths(result.findings, root),
  );
  const combinedFindings = aggregate([...allRawFindings, ...sastFindings]);
  const combinedCostUSD = rawRuns.reduce((s, { result }) => s + result.usage.costUSD, 0);

  log.info(`Combined (all ${instances.length} models + SAST): ${combinedFindings.length} findings`);

  // For each single reviewer: what does it find alone vs combined?
  const singleResults: ReviewerStrategyResult[] = rawRuns.map(({ inst, result }) => {
    const singleFindings = aggregate([
      ...normalizeFindingPaths(result.findings, root),
      ...sastFindings,
    ]);

    const diffVsCombined = diffFindings(singleFindings, combinedFindings);
    const missedVsCombined = diffVsCombined.introduced; // in combined but not in single

    // Unique to this model = in this single run but not in any other single run
    // Use provider+model as identity to avoid collisions if two reviewers share a name.
    const instKey = `${inst.ref.provider}/${inst.ref.model}`;
    const otherFindings = aggregate([
      ...rawRuns
        .filter(({ inst: other }) => `${other.ref.provider}/${other.ref.model}` !== instKey)
        .flatMap(({ result: r }) => normalizeFindingPaths(r.findings, root)),
      ...sastFindings,
    ]);
    const diffVsOthers = diffFindings(otherFindings, singleFindings);
    const uniqueToThis = diffVsOthers.introduced;

    log.info(
      `  ${inst.ref.name}: ${singleFindings.length} findings · missed ${missedVsCombined.length} vs combined · ${uniqueToThis.length} unique`,
    );

    return {
      name: inst.ref.name,
      findings: singleFindings,
      costUSD: result.usage.costUSD,
      durationMs: result.durationMs,
      status: result.status === 'failed' ? 'failed' : 'ok',
      missedVsCombined,
      uniqueToThis,
    };
  });

  return {
    root,
    singleResults,
    combinedFindings,
    combinedCostUSD,
    totalDurationMs: Date.now() - start,
  };
}

export function renderReviewerBenchmarkReport(output: ReviewerBenchmarkOutput): string {
  const parts: string[] = [];
  const ts = new Date().toISOString();

  parts.push('# Secure Review — Reviewer Strategy Benchmark');
  parts.push(`\nGenerated: ${ts}`);
  parts.push(`**Path:** \`${output.root}\`\n`);

  parts.push('## Summary\n');
  parts.push('| Reviewer | Findings (solo) | Missed vs Combined | Unique to this model | Cost | Status |');
  parts.push('|---|---:|---:|---:|---:|---|');

  for (const r of output.singleResults) {
    const missed = r.missedVsCombined.length;
    const missedPct = output.combinedFindings.length > 0
      ? ((missed / output.combinedFindings.length) * 100).toFixed(0)
      : '0';
    parts.push(
      `| ${r.name} | ${r.findings.length} | ${missed} (${missedPct}% blind spot) | ${r.uniqueToThis.length} | $${r.costUSD.toFixed(3)} | ${r.status} |`,
    );
  }

  // Combined row
  parts.push(
    `| **Combined (all models)** | **${output.combinedFindings.length}** | **0** | **—** | **$${output.combinedCostUSD.toFixed(3)}** | — |`,
  );
  parts.push('');

  // Agreement breakdown on combined findings
  const maxAgreement = output.combinedFindings.reduce(
    (m, f) => Math.max(m, agreementCount(f)),
    0,
  );
  const thresholds = Array.from(new Set([maxAgreement, 3, 2, 1].filter((n) => n >= 1))).sort(
    (a, b) => b - a,
  );
  const byAgreement = thresholds.map((n) => ({
    count: n,
    findings: output.combinedFindings.filter((f) => agreementCount(f) >= n),
  }));
  parts.push('## Multi-Model Agreement on Combined Findings\n');
  parts.push('| Agreement | Findings | Share |');
  parts.push('|---|---:|---:|');
  for (const { count, findings } of byAgreement) {
    const pct = output.combinedFindings.length > 0
      ? ((findings.length / output.combinedFindings.length) * 100).toFixed(0)
      : '0';
    parts.push(`| ${count}+ model${count !== 1 ? 's' : ''} agreed | ${findings.length} | ${pct}% |`);
  }
  parts.push('');

  // What each single model misses
  for (const r of output.singleResults) {
    if (r.missedVsCombined.length === 0) continue;
    parts.push(`## What ${r.name} Missed (${r.missedVsCombined.length} findings)\n`);
    for (const f of r.missedVsCombined) {
      parts.push(
        `- **${f.severity}** \`${f.file}:${f.lineStart}\` — ${f.title}${f.cwe ? ` (${f.cwe})` : ''} · *reported by: ${f.reportedBy.join(', ')}*`,
      );
    }
    parts.push('');
  }

  // What each model found uniquely
  for (const r of output.singleResults) {
    if (r.uniqueToThis.length === 0) continue;
    parts.push(`## Unique to ${r.name} (${r.uniqueToThis.length} findings)\n`);
    for (const f of r.uniqueToThis) {
      parts.push(
        `- **${f.severity}** \`${f.file}:${f.lineStart}\` — ${f.title}${f.cwe ? ` (${f.cwe})` : ''}`,
      );
    }
    parts.push('');
  }

  return parts.join('\n');
}
