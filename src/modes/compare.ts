import type { Env, SecureReviewConfig } from '../config/schema.js';
import { diffFindings } from '../findings/diff.js';
import type { Finding } from '../findings/schema.js';
import { runReviewMode, type ReviewModeOutput } from './review.js';
import { log } from '../util/logger.js';

export interface CompareModeInput {
  rootA: string;
  rootB: string;
  config: SecureReviewConfig;
  configDir: string;
  env: Env;
}

export interface CompareModeOutput {
  pathA: string;
  pathB: string;
  outputA: ReviewModeOutput;
  outputB: ReviewModeOutput;
  uniqueToA: Finding[];
  uniqueToB: Finding[];
  common: Finding[];
  delta: 'better' | 'worse' | 'same';
  totalDurationMs: number;
}

/**
 * Compare mode: runs review on two paths in parallel and produces a
 * side-by-side comparison showing unique/common findings and delta.
 */
export async function runCompareMode(input: CompareModeInput): Promise<CompareModeOutput> {
  const { rootA, rootB, config, configDir, env } = input;
  const start = Date.now();

  log.header(`Compare mode — ${rootA} vs ${rootB}`);
  log.info('Running reviews in parallel...');

  const [outputA, outputB] = await Promise.all([
    runReviewMode({ root: rootA, config, configDir, env }),
    runReviewMode({ root: rootB, config, configDir, env }),
  ]);

  log.info(`Path A: ${outputA.findings.length} finding(s)`);
  log.info(`Path B: ${outputB.findings.length} finding(s)`);

  // Compute unique-to-A, unique-to-B, and common using diffFindings
  // diffFindings(before=A, after=B) gives:
  //   resolved = present in A but not B (unique to A)
  //   introduced = present in B but not A (unique to B)
  //   remaining = present in both (common)
  const diff = diffFindings(outputA.findings, outputB.findings);

  const uniqueToA = diff.resolved;
  const uniqueToB = diff.introduced;
  const common = diff.remaining;

  // Delta: B is better if it has fewer total findings, worse if more
  let delta: CompareModeOutput['delta'] = 'same';
  if (outputB.findings.length < outputA.findings.length) {
    delta = 'better';
  } else if (outputB.findings.length > outputA.findings.length) {
    delta = 'worse';
  }

  log.info(`Delta: B is ${delta} vs A (A=${outputA.findings.length}, B=${outputB.findings.length})`);
  log.info(`  Common: ${common.length}, Unique to A: ${uniqueToA.length}, Unique to B: ${uniqueToB.length}`);

  return {
    pathA: rootA,
    pathB: rootB,
    outputA,
    outputB,
    uniqueToA,
    uniqueToB,
    common,
    delta,
    totalDurationMs: Date.now() - start,
  };
}

/** Render the comparison as a markdown report. */
export function renderCompareReport(output: CompareModeOutput): string {
  const parts: string[] = [];

  parts.push('# Secure Review — Compare Report');
  parts.push(`\nGenerated: ${new Date().toISOString()}`);
  parts.push(`\n**Path A:** \`${output.pathA}\``);
  parts.push(`**Path B:** \`${output.pathB}\``);
  parts.push(`**Delta:** B is **${output.delta}** vs A\n`);

  // Summary table
  parts.push('## Finding Count by Severity\n');
  parts.push('| Severity | Path A | Path B | Delta |');
  parts.push('|---|---:|---:|---:|');
  for (const k of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const) {
    const a = output.outputA.breakdown[k];
    const b = output.outputB.breakdown[k];
    const d = b - a;
    parts.push(`| ${k} | ${a} | ${b} | ${d > 0 ? '+' + d : d} |`);
  }
  const totalA = output.outputA.findings.length;
  const totalB = output.outputB.findings.length;
  const totalDelta = totalB - totalA;
  parts.push(`| **Total** | **${totalA}** | **${totalB}** | **${totalDelta > 0 ? '+' + totalDelta : totalDelta}** |`);
  parts.push('');

  // Cost / duration overview
  parts.push('## Run Stats\n');
  parts.push('| Metric | Path A | Path B |');
  parts.push('|---|---:|---:|');
  parts.push(`| Cost (USD) | $${output.outputA.totalCostUSD.toFixed(3)} | $${output.outputB.totalCostUSD.toFixed(3)} |`);
  parts.push(`| Duration | ${(output.outputA.totalDurationMs / 1000).toFixed(1)}s | ${(output.outputB.totalDurationMs / 1000).toFixed(1)}s |`);
  parts.push('');

  // Common findings
  parts.push(`## Common Findings (${output.common.length})\n`);
  if (output.common.length === 0) {
    parts.push('_No findings shared between A and B._');
  } else {
    for (const f of output.common) {
      parts.push(`- **${f.severity}** \`${f.file}:${f.lineStart}\` — ${f.title}${f.cwe ? ` (${f.cwe})` : ''}`);
    }
  }
  parts.push('');

  // Unique to A
  parts.push(`## Findings Unique to A (${output.uniqueToA.length})\n`);
  if (output.uniqueToA.length === 0) {
    parts.push('_None._');
  } else {
    for (const f of output.uniqueToA) {
      parts.push(`- **${f.severity}** \`${f.file}:${f.lineStart}\` — ${f.title}${f.cwe ? ` (${f.cwe})` : ''}`);
    }
  }
  parts.push('');

  // Unique to B
  parts.push(`## Findings Unique to B (${output.uniqueToB.length})\n`);
  if (output.uniqueToB.length === 0) {
    parts.push('_None._');
  } else {
    for (const f of output.uniqueToB) {
      parts.push(`- **${f.severity}** \`${f.file}:${f.lineStart}\` — ${f.title}${f.cwe ? ` (${f.cwe})` : ''}`);
    }
  }
  parts.push('');

  return parts.join('\n');
}
