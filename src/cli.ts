#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

// Auto-load .env from CWD if present. Saves users from
// 'set -a; source .env; set +a' before every invocation.
// process.loadEnvFile is a built-in Node 20.12+ API — no extra dependency.
// Security: .env files should be restricted to mode 600 and listed in .gitignore.
//
// Behavior: loadEnvFile does NOT override existing process.env entries (Node
// convention, matches dotenv/python-dotenv defaults). When the shell already
// exports a key that .env also defines, the shell value silently wins. That
// has been a confusing failure mode in practice ("I edited .env, why is the
// tool still using the old key?"). Detect the conflict up front and warn.
if (existsSync('.env')) {
  warnEnvConflicts('.env');
  try {
    process.loadEnvFile('.env');
  } catch {
    // older Node, or malformed .env — fall back silently
  }
}

function parseEnvFile(path: string): Map<string, string> {
  const vars = new Map<string, string>();
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return vars;
  }
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    vars.set(key, val);
  }
  return vars;
}

function maskSecret(v: string): string {
  if (v.length <= 8) return '****';
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function warnEnvConflicts(envFilePath: string): void {
  const fileVars = parseEnvFile(envFilePath);
  const conflicts: Array<{ key: string; fileValue: string; shellValue: string }> = [];
  for (const [key, fileValue] of fileVars) {
    const shellValue = process.env[key];
    if (shellValue !== undefined && shellValue !== fileValue) {
      conflicts.push({ key, fileValue, shellValue });
    }
  }
  if (conflicts.length === 0) return;
  const out = process.stderr;
  out.write('\n⚠ .env vs shell environment conflict — shell value is being used:\n');
  for (const c of conflicts) {
    out.write(`   ${c.key}:\n`);
    out.write(`     .env:   ${maskSecret(c.fileValue)}   (ignored)\n`);
    out.write(`     shell:  ${maskSecret(c.shellValue)}   (used — Node convention)\n`);
  }
  out.write(
    `   To use .env values instead, run:  unset ${conflicts.map((c) => c.key).join(' ')}\n\n`,
  );
}
import { Command, InvalidArgumentError } from 'commander';
import { z } from 'zod';
import { loadConfig, loadEnv } from './config/load.js';
import { runReviewMode } from './modes/review.js';
import { runFixMode } from './modes/fix.js';
import { runBenchmarkMode, renderBenchmarkReport } from './modes/benchmark.js';
import { runCompareMode, renderCompareReport } from './modes/compare.js';
import { runReviewerBenchmark, renderReviewerBenchmarkReport } from './modes/reviewer-benchmark.js';
import { renderReviewReport, renderFixReport } from './reporters/markdown.js';
import { renderReviewHtml, renderFixHtml } from './reporters/html.js';
import { renderReviewEvidence, renderFixEvidence } from './reporters/json.js';
import { evaluatePrGates, postPrReview } from './reporters/github-pr.js';
import { writeFileSafe, getGitChangedFiles, readSourceTree } from './util/files.js';
import {
  DEFAULT_BASELINE_FILENAME,
  baselineFromFindings,
  loadBaseline,
  mergeBaseline,
  saveBaseline,
} from './findings/baseline.js';
import { FindingSchema, type Finding } from './findings/schema.js';
import { log, setQuiet, setVerbose } from './util/logger.js';
import {
  estimateRunCost,
  formatEstimateText,
  type EstimateMode,
} from './util/estimate-cost.js';

const execFileAsync = promisify(execFile);

const DEFAULT_OUTPUT = {
  report: './reports/report-{timestamp}.md',
  findings: './reports/findings-{timestamp}.json',
  diff: './reports/diff-{timestamp}.patch',
} as const;

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function outputPath(
  configured: string,
  defaultConfigured: string,
  outputDir: string,
  fallbackName: string,
  stamp: string,
): string {
  const path = configured === defaultConfigured ? resolve(outputDir, fallbackName) : configured;
  return resolve(path.replaceAll('{timestamp}', stamp));
}

export function parseMaxIterations(raw: string): number {
  if (raw.trim() === '') throw new InvalidArgumentError('max iterations must be an integer from 1 to 10');
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    throw new InvalidArgumentError('max iterations must be an integer from 1 to 10');
  }
  return n;
}

export function parseMaxCostUsd(raw: string): number {
  if (raw.trim() === '') throw new InvalidArgumentError('max cost must be a finite number greater than or equal to 0');
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new InvalidArgumentError('max cost must be a finite number greater than or equal to 0');
  }
  return n;
}

export function parseMaxWallTimeMinutes(raw: string): number {
  if (raw.trim() === '') throw new InvalidArgumentError('wall-time cap must be a finite number greater than 0 minutes');
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new InvalidArgumentError('wall-time cap must be a finite number greater than 0 minutes');
  }
  return n;
}

/** Read a GitHub Actions workflow input from `INPUT_<NAME>`. */
function ghActionInput(name: string): string | undefined {
  const normalized = name.replace(/-/g, '_').toUpperCase();
  const raw = process.env[`INPUT_${normalized}`];
  if (raw === undefined || raw === '') return undefined;
  return raw.trim();
}

function applyMaxCostOverride(config: Awaited<ReturnType<typeof loadConfig>>['config'], value?: number): void {
  if (value === undefined) return;
  config.gates.max_cost_usd = value;
}

function applyMaxWallTimeOverride(config: Awaited<ReturnType<typeof loadConfig>>['config'], value?: number): void {
  if (value === undefined) return;
  config.gates.max_wall_time_minutes = value;
}

/**
 * Resolve a baseline file path and load it, honoring the `--baseline` CLI flag:
 *   --baseline <path>  → explicit path; error if file missing
 *   --baseline none    → skip baseline entirely (sentinel value, in case the
 *                        scan root has a stale .secure-review-baseline.json)
 *   omitted            → auto-detect `.secure-review-baseline.json` in the
 *                        scan root (silent no-op if absent)
 */
async function resolveBaseline(
  scanRoot: string,
  explicitPath: string | undefined,
): Promise<{ baseline: Awaited<ReturnType<typeof loadBaseline>>; path?: string }> {
  if (explicitPath === 'none') return { baseline: undefined };
  if (explicitPath) {
    const abs = resolve(explicitPath);
    const baseline = await loadBaseline(abs);
    if (!baseline) throw new Error(`Baseline file not found: ${abs}`);
    log.info(`Baseline: loaded ${baseline.entries.length} accepted finding(s) from ${abs}`);
    return { baseline, path: abs };
  }
  const auto = resolve(scanRoot, DEFAULT_BASELINE_FILENAME);
  const baseline = await loadBaseline(auto);
  if (baseline) {
    // Bug 2 (PR #3 audit): auto-load is silent by default — escalate to
    // `warn` so users notice that headline finding counts are being
    // affected by a stale on-disk baseline. Pass `--baseline none` to
    // disable auto-load explicitly.
    log.warn(
      `Baseline: auto-loaded ${baseline.entries.length} accepted finding(s) from ${auto}. Pass --baseline none to disable.`,
    );
    return { baseline, path: auto };
  }
  return { baseline: undefined };
}

/**
 * Print a pre-run cost estimate and (in interactive shells) ask the user to
 * confirm before spending the budget. Returns `true` if the run should proceed.
 *
 * Policy:
 *   - `--no-estimate` / `--skip-cost-estimate` → silently proceed.
 *   - `--yes`                                  → print estimate, skip prompt.
 *   - interactive (TTY)                        → print estimate, ask.
 *   - non-interactive (CI, piped stdin/out)    → print estimate, proceed.
 *     (`gates.max_cost_usd` is the budget contract for unattended runs;
 *      blocking on a missing TTY would break every CI invocation and the
 *      experiment's reproducibility scripts.)
 */
async function previewAndConfirmCost(
  scanRoot: string,
  config: Awaited<ReturnType<typeof loadConfig>>['config'],
  mode: EstimateMode,
  flags: { yes: boolean; skipEstimate: boolean; quiet: boolean; only?: Set<string>; since?: string },
): Promise<boolean> {
  if (flags.skipEstimate) return true;
  // Bug 8 (PR #3 audit): when --since is set the estimate must count only
  // the incremental file subset, not the full tree. Pre-fix the estimate
  // always read the full tree, so users running `review ./src --since main`
  // on a 1000-file repo saw a $X cost based on 1000 files even when --since
  // would scope it to 5 (or zero — combined with Bug 4 the estimate was
  // 200x off in the worst case).
  //
  // Caller may pre-compute the `only` set and pass it via `flags.only` to
  // avoid running `getGitChangedFiles` twice (once here, once in the
  // action). When `flags.only` is provided we skip the git call entirely.
  // `flags.since` remains accepted for callers that don't pre-compute,
  // and is also used purely for the empty-set warning message.
  const only = flags.only
    ?? (flags.since ? await getGitChangedFiles(scanRoot, flags.since) : undefined);
  const files = await readSourceTree(scanRoot, 200_000, only);
  if (files.length === 0) {
    if (flags.since) {
      log.warn(`No source files matched --since ${flags.since} — skipping cost estimate (and the actual run will also be a no-op).`);
    } else {
      log.warn('No source files found under scan root — skipping cost estimate.');
    }
    return true;
  }
  // NOTE: token budgeting in `estimateRunCost` uses a fixed
  // SAST_INJECTED_TOKENS constant which can over-estimate slightly under
  // --since (Bug 9's post-filter shrinks the actual SAST injection set).
  // Over-estimating is the safer direction; budget cap (gates.max_cost_usd)
  // applies to actual runs, not the estimate.
  const estimate = estimateRunCost({ config, files, mode });
  if (!flags.quiet) {
    log.info(formatEstimateText(estimate, mode, config.gates.max_cost_usd));
  }
  if (flags.yes) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    if (!flags.quiet) {
      log.info(
        `Non-interactive shell — proceeding without prompt. Cap: $${config.gates.max_cost_usd.toFixed(2)} (set --yes to silence this notice).`,
      );
    }
    return true;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Proceed? [y/N] ')).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

function enforceReviewHealth(output: {
  reviewStatus: 'ok' | 'degraded' | 'failed';
  failedReviewers: string[];
}): void {
  if (output.reviewStatus === 'failed') {
    log.error(`Reviewers unavailable: ${formatReviewerNames(output.failedReviewers)}`);
    process.exit(3);
  }
  if (output.reviewStatus === 'degraded') {
    log.warn(`Review degraded; failed reviewer(s): ${formatReviewerNames(output.failedReviewers)}`);
  }
}

function formatReviewerNames(names: string[]): string {
  return names.length > 0 ? names.join(', ') : '(unknown)';
}

async function readGitDiff(root: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'diff', '--no-ext-diff', '--binary', '--'], {
      maxBuffer: 50 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Could not capture git diff: ${message}`);
    return '';
  }
}

async function readPackageVersion(): Promise<string> {
  // Read OUR package.json next to dist/, NOT the user's CWD package.json.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', 'package.json'),
    resolve(here, '..', '..', 'package.json'),
  ];
  for (const candidate of candidates) {
    try {
      const raw = JSON.parse(await readFile(candidate, 'utf8')) as unknown;
      const PackageSchema = z.object({ name: z.string().optional(), version: z.string().optional() });
      const meta = PackageSchema.parse(raw);
      if (meta.name === 'secure-review' && meta.version) return meta.version;
    } catch {
      // try next
    }
  }
  return '0.0.0';
}

const GithubPrEventSchema = z.object({
  pull_request: z
    .object({
      number: z.number(),
      head: z.object({
        sha: z.string(),
        repo: z.object({ fork: z.boolean().optional() }).optional(),
      }),
      base: z.object({ sha: z.string(), ref: z.string() }),
    })
    .optional(),
  repository: z
    .object({
      owner: z.object({ login: z.string().optional() }).optional(),
      name: z.string().optional(),
    })
    .optional(),
});

async function main(): Promise<void> {
  const version = await readPackageVersion();
  const program = new Command();
  program
    .name('secure-review')
    .description('Multi-model security review for AI-generated code')
    .version(version)
    .option('-q, --quiet', 'suppress info output', false)
    .option('-v, --verbose', 'enable debug output', false)
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts<{ quiet?: boolean; verbose?: boolean }>();
      if (opts.quiet) setQuiet(true);
      if (opts.verbose) setVerbose(true);
    });

  program
    .command('init')
    .description('Scaffold .secure-review.yml + .env in the current directory.')
    .option('-y, --yes', 'skip questions, accept defaults (all 3 providers + SAST + .env.example)', false)
    .option('-f, --force', 'overwrite existing .secure-review.yml', false)
    .action(async (opts: { yes: boolean; force: boolean }) => {
      try {
        const { runInit } = await import('./commands/init.js');
        await runInit({ yes: opts.yes, force: opts.force });
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  program
    .command('baseline')
    .description('Create or update a baseline file from a previous review/fix findings JSON.')
    .argument('<findings-json>', 'path to a review-*.json or fix-*.json findings file')
    .option('-o, --out <file>', `output baseline file (default: ${DEFAULT_BASELINE_FILENAME} in CWD)`, DEFAULT_BASELINE_FILENAME)
    .option('--reason <text>', 'rationale to record on each new entry (e.g. "test fixture")')
    .option('--merge', 'merge into an existing baseline file instead of overwriting it (preserves prior reasons)', false)
    .action(async (findingsJsonPath: string, opts: { out: string; reason?: string; merge: boolean }) => {
      try {
        const findingsAbs = resolve(findingsJsonPath);
        const outAbs = resolve(opts.out);
        const raw = JSON.parse(await readFile(findingsAbs, 'utf8')) as { findings?: unknown };
        const findingsRaw = Array.isArray(raw.findings) ? raw.findings : Array.isArray(raw) ? raw : null;
        if (!findingsRaw) {
          throw new Error(
            `Could not find a 'findings' array in ${findingsAbs}. Pass a review/fix findings JSON or a raw Finding[].`,
          );
        }
        const findings: Finding[] = findingsRaw.map((f, i) => {
          const parsed = FindingSchema.safeParse(f);
          if (!parsed.success) {
            throw new Error(`Entry #${i + 1} is not a valid Finding: ${parsed.error.message}`);
          }
          return parsed.data;
        });
        const existing = opts.merge ? await loadBaseline(outAbs) : undefined;
        const next = existing
          ? mergeBaseline(existing, findings, opts.reason)
          : baselineFromFindings(findings, opts.reason);
        await saveBaseline(outAbs, next);
        const added = next.entries.length - (existing?.entries.length ?? 0);
        log.success(`Baseline written: ${outAbs}`);
        log.info(
          `${next.entries.length} accepted finding(s) total${existing ? ` (+${added} new)` : ''}` +
            (opts.reason ? ` · reason: "${opts.reason}"` : ''),
        );
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  program
    .command('review')
    .description('Run multi-model review on a path. Posts no changes.')
    .argument('<path>', 'path to review')
    .option('-c, --config <file>', 'config file', '.secure-review.yml')
    .option('-o, --output-dir <dir>', 'output directory', './reports')
    .option('--since <ref>', 'only review files changed since this git ref (branch, commit, or tag)')
    .option('--baseline <file|none>', `baseline file of accepted findings; pass 'none' to disable (default: auto-detect ${DEFAULT_BASELINE_FILENAME} in scan root)`)
    .option('--task-id <id>', 'task identifier for evidence JSON', 'unknown')
    .option('--run <n>', 'run number', '1')
    .option('-y, --yes', 'skip the pre-run cost-estimate confirmation prompt', false)
    .option('--no-estimate', 'skip the pre-run cost estimate entirely (no print, no prompt)')
    .action(async (path: string, opts: { config: string; outputDir: string; since?: string; baseline?: string; taskId: string; run: string; yes: boolean; estimate: boolean }) => {
      try {
        const { config, configDir } = await loadConfig(opts.config);
        const env = loadEnv();
        const root = resolve(path);
        // Compute the --since file set ONCE and pass it to both the cost
        // estimate and the actual review (Bug 8 follow-up). Avoids running
        // `git diff --name-only` twice on large repos and eliminates the
        // tiny TOCTOU window between estimate and run.
        const only = opts.since ? await getGitChangedFiles(root, opts.since) : undefined;
        const proceed = await previewAndConfirmCost(root, config, 'review', {
          yes: opts.yes,
          skipEstimate: opts.estimate === false,
          quiet: program.opts<{ quiet?: boolean }>().quiet === true,
          only,
          since: opts.since,
        });
        if (!proceed) {
          log.warn('Aborted by user before running review.');
          process.exit(0);
        }
        if (only) log.info(`Incremental mode: ${only.size} file${only.size === 1 ? '' : 's'} changed since ${opts.since}`);
        const { baseline } = await resolveBaseline(root, opts.baseline);
        const output = await runReviewMode({ root, config, configDir, env, only, baseline });
        enforceReviewHealth(output);

        const stamp = timestamp();
        const mdPath = outputPath(
          config.output.report,
          DEFAULT_OUTPUT.report,
          opts.outputDir,
          `review-${stamp}.md`,
          stamp,
        );
        const htmlPath = mdPath.replace(/\.md$/, '.html');
        const jsonPath = outputPath(
          config.output.findings,
          DEFAULT_OUTPUT.findings,
          opts.outputDir,
          `review-${stamp}.json`,
          stamp,
        );
        await writeFileSafe(mdPath, renderReviewReport(output));
        await writeFileSafe(htmlPath, renderReviewHtml(output));
        const evidence = renderReviewEvidence(output, {
          taskId: opts.taskId,
          run: Number(opts.run),
          modelVersion: config.reviewers.map((r) => r.model).join('+'),
          toolVersion: version,
          reviewerNames: config.reviewers.map((r) => r.name),
        });
        await writeFileSafe(jsonPath, JSON.stringify(evidence, null, 2));

        log.success(`Report:    ${mdPath}`);
        log.success(`HTML:      ${htmlPath}`);
        log.success(`Findings:  ${jsonPath}`);
        const baselineNote = output.baselineSuppressed.length > 0
          ? ` · ${output.baselineSuppressed.length} baselined`
          : '';
        log.info(`Total: ${output.findings.length} findings${baselineNote} · $${output.totalCostUSD.toFixed(3)}`);
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  program
    .command('fix')
    .description('Run cross-model fix loop. Writer applies fixes; reviewers rotate.')
    .argument('<path>', 'path to review and fix')
    .option('-c, --config <file>', 'config file', '.secure-review.yml')
    .option('-o, --output-dir <dir>', 'output directory', './reports')
    .option('--since <ref>', 'only review/fix files changed since this git ref (branch, commit, or tag)')
    .option('--baseline <file|none>', `baseline file of accepted findings; pass 'none' to disable (default: auto-detect ${DEFAULT_BASELINE_FILENAME} in scan root)`)
    .option('--max-iterations <n>', 'override max iterations', parseMaxIterations)
    .option('--max-cost-usd <n>', 'override cost cap', parseMaxCostUsd)
    .option('--max-wall-time-minutes <n>', 'override wall-time cap for the fix loop', parseMaxWallTimeMinutes)
    .option('--task-id <id>', 'task identifier for evidence JSON', 'unknown')
    .option('--run <n>', 'run number', '1')
    .option('-y, --yes', 'skip the pre-run cost-estimate confirmation prompt', false)
    .option('--no-estimate', 'skip the pre-run cost estimate entirely (no print, no prompt)')
    .action(
      async (
        path: string,
        opts: {
          config: string;
          outputDir: string;
          since?: string;
          baseline?: string;
          maxIterations?: number;
          maxCostUsd?: number;
          maxWallTimeMinutes?: number;
          taskId: string;
          run: string;
          yes: boolean;
          estimate: boolean;
        },
      ) => {
        try {
          const { config, configDir } = await loadConfig(opts.config);
          const env = loadEnv();
          if (opts.maxIterations !== undefined) config.fix.max_iterations = opts.maxIterations;
          applyMaxCostOverride(config, opts.maxCostUsd);
          applyMaxWallTimeOverride(config, opts.maxWallTimeMinutes);
          const root = resolve(path);
          // Compute the --since file set ONCE and pass it to both the cost
          // estimate and the actual fix (Bug 8 follow-up). Avoids two git
          // calls + eliminates TOCTOU between estimate and run.
          const only = opts.since ? await getGitChangedFiles(root, opts.since) : undefined;
          const proceed = await previewAndConfirmCost(root, config, 'fix', {
            yes: opts.yes,
            skipEstimate: opts.estimate === false,
            quiet: program.opts<{ quiet?: boolean }>().quiet === true,
            only,
            since: opts.since,
          });
          if (!proceed) {
            log.warn('Aborted by user before running fix.');
            process.exit(0);
          }
          if (only) log.info(`Incremental mode: ${only.size} file${only.size === 1 ? '' : 's'} changed since ${opts.since}`);
          const { baseline } = await resolveBaseline(root, opts.baseline);
          const output = await runFixMode({ root, config, configDir, env, only, baseline });
          enforceReviewHealth(output);

          const stamp = timestamp();
          const mdPath = outputPath(
            config.output.report,
            DEFAULT_OUTPUT.report,
            opts.outputDir,
            `fix-${stamp}.md`,
            stamp,
          );
          const htmlPath = mdPath.replace(/\.md$/, '.html');
          const jsonPath = outputPath(
            config.output.findings,
            DEFAULT_OUTPUT.findings,
            opts.outputDir,
            `fix-${stamp}.json`,
            stamp,
          );
          const diffPath = outputPath(
            config.output.diff,
            DEFAULT_OUTPUT.diff,
            opts.outputDir,
            `fix-${stamp}.patch`,
            stamp,
          );
          await writeFileSafe(mdPath, renderFixReport(output));
          await writeFileSafe(htmlPath, renderFixHtml(output));
          const evidence = renderFixEvidence(output, {
            taskId: opts.taskId,
            run: Number(opts.run),
            modelVersion: `${config.writer.model}|${config.reviewers.map((r) => r.model).join('+')}`,
            toolVersion: version,
            reviewerNames: config.reviewers.map((r) => r.name),
          });
          await writeFileSafe(jsonPath, JSON.stringify(evidence, null, 2));
          await writeFileSafe(diffPath, await readGitDiff(root));

          log.success(`Report:    ${mdPath}`);
          log.success(`HTML:      ${htmlPath}`);
          log.success(`Findings:  ${jsonPath}`);
          log.success(`Diff:      ${diffPath}`);
          const baselineNote = output.baselineSuppressed.length > 0
            ? `  Baselined: ${output.baselineSuppressed.length}`
            : '';
          log.info(
            `Initial: ${output.initialFindings.length}  Final: ${output.finalFindings.length}  Resolved: ${evidence.findings_resolved} (${evidence.resolution_rate_pct}%)  Introduced: ${evidence.new_findings_introduced}${baselineNote}  Cost: $${output.totalCostUSD.toFixed(3)}`,
          );
          if (output.gateBlocked) process.exit(2);
        } catch (err) {
          log.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  program
    .command('pr')
    .description('GitHub Action entrypoint — multi-model static security review and PR inline comments.')
    .option('-c, --config <file>', 'config file', '.secure-review.yml')
    .option('--autofix', 'deprecated no-op; static review always runs', false)
    .option('--max-cost-usd <n>', 'override cost cap (static review)', parseMaxCostUsd)
    .action(async (opts: { config: string; autofix: boolean; maxCostUsd?: number }) => {
      try {
        const { config, configDir } = await loadConfig(opts.config);
        const env = loadEnv();
        applyMaxCostOverride(config, opts.maxCostUsd);

        if (opts.autofix) {
          log.warn('PR autofix mode is deprecated and a no-op; running static review.');
        }
        const legacyMode = ghActionInput('mode')?.trim().toLowerCase();
        if (legacyMode === 'attack' || legacyMode === 'attack-ai') {
          log.warn(
            'Runtime attack modes moved to the secure-review-runtime package; running static review only.',
          );
        } else if (legacyMode === 'fix') {
          log.warn('INPUT mode=fix is deprecated; using static multi-model review.');
        }

        const eventPath = process.env.GITHUB_EVENT_PATH;
        if (!eventPath)
          throw new Error(
            '`pr` is the GitHub Action entry point and requires a runner context (GITHUB_EVENT_PATH).\n' +
              'For local invocation use:\n' +
              '  secure-review review <path>           # multi-model review on a path\n' +
              '  secure-review scan <path>             # SAST only\n' +
              '  secure-review fix <path>              # iterative review + fix loop',
          );
        const rawEvent = JSON.parse(await readFile(eventPath, 'utf8')) as unknown;
        const eventParseResult = GithubPrEventSchema.safeParse(rawEvent);
        if (!eventParseResult.success) {
          throw new Error(`Invalid GitHub event payload: ${eventParseResult.error.message}`);
        }
        const event = eventParseResult.data;
        if (!event.pull_request) throw new Error('Event is not a pull_request event');
        const pr = event.pull_request;

        if (pr.head.repo?.fork) {
          log.warn('PR is from a fork; secrets not exposed. Skipping.');
          return;
        }

        const owner = event.repository?.owner?.login;
        const repo = event.repository?.name;
        if (!owner || !repo) throw new Error('Could not determine owner/repo from event payload');

        const token = env.GITHUB_TOKEN;
        if (!token) throw new Error('GITHUB_TOKEN is not set');

        const { Octokit } = await import('@octokit/rest');
        const octokit = new Octokit({ auth: token });
        const { listPullRequestFiles } = await import('./util/github-pr-files.js');
        const prFiles = await listPullRequestFiles(octokit, {
          owner,
          repo,
          pull_number: pr.number,
        });
        const { commentableLinesByFile } = await import('./util/diff.js');
        const commentableLines = commentableLinesByFile(prFiles);
        const totalCommentable = Array.from(commentableLines.values()).reduce(
          (n, s) => n + s.size,
          0,
        );
        log.info(
          `PR #${pr.number} — ${commentableLines.size} changed files, ${totalCommentable} diff-commentable lines`,
        );

        const output = await runReviewMode({
          root: process.cwd(),
          config,
          configDir,
          env,
        });
        enforceReviewHealth(output);

        const prResult = await postPrReview(output, {
          owner,
          repo,
          prNumber: pr.number,
          commitSha: pr.head.sha,
          token,
          commentableLines,
        });

        const prGate = evaluatePrGates(prResult, output.totalCostUSD, config.gates);
        if (prGate.blocked) {
          log.error(`PR gate blocked: ${prGate.reasons.join('; ')}`);
          process.exit(2);
        }
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });


  program
    .command('estimate')
    .description('Print a pre-run cost estimate without invoking any model.')
    .argument('<path>', 'path that would be reviewed/fixed')
    .option('-c, --config <file>', 'config file', '.secure-review.yml')
    .option('-m, --mode <mode>', 'estimate for `review` or `fix` mode', 'fix')
    .option('--max-iterations <n>', 'override max iterations (fix mode)', parseMaxIterations)
    .option('--since <ref>', 'estimate for incremental scope (only files changed since this git ref)')
    .action(async (path: string, opts: { config: string; mode: string; maxIterations?: number; since?: string }) => {
      try {
        const mode = opts.mode === 'review' ? 'review' : 'fix';
        if (opts.mode !== 'review' && opts.mode !== 'fix') {
          log.warn(`Unknown mode '${opts.mode}', defaulting to 'fix'`);
        }
        const { config } = await loadConfig(opts.config);
        if (opts.maxIterations !== undefined) config.fix.max_iterations = opts.maxIterations;
        const root = resolve(path);
        // Bug 8 (PR #3 audit): standalone `estimate` subcommand also needs
        // --since support so its output matches what `review`/`fix` will
        // actually scan when run with the same flag.
        const only = opts.since ? await getGitChangedFiles(root, opts.since) : undefined;
        const files = await readSourceTree(root, 200_000, only);
        if (files.length === 0) {
          if (opts.since) {
            log.warn(`No source files matched --since ${opts.since}.`);
          } else {
            log.warn('No source files found under scan root.');
          }
          return;
        }
        const estimate = estimateRunCost({ config, files, mode });
        log.info(formatEstimateText(estimate, mode, config.gates.max_cost_usd));
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  program
    .command('scan')
    .description('Run SAST only (semgrep + eslint + npm audit). No AI calls.')
    .argument('<path>', 'path to scan')
    .option('-c, --config <file>', 'config file', '.secure-review.yml')
    .action(async (path: string, opts: { config: string }) => {
      try {
        const { config } = await loadConfig(opts.config);
        const { runAllSast } = await import('./sast/index.js');
        const result = await runAllSast(resolve(path), config.sast);
        log.info(JSON.stringify(
          {
            semgrep: result.semgrep,
            eslint: result.eslint,
            npmAudit: result.npmAudit,
            totalFindings: result.findings.length,
          },
          null,
          2,
        ));
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  program
    .command('setup-secrets')
    .description('Set GitHub Action secrets via gh CLI (one secret per enabled provider).')
    .option('-c, --config <file>', 'config file', '.secure-review.yml')
    .option('--repo <owner/name>', 'override target repo (default: gh detects from current git remote)')
    .action(async (opts: { config: string; repo?: string }) => {
      try {
        const { runSetupSecrets } = await import('./commands/setup-secrets.js');
        await runSetupSecrets({ config: opts.config, repo: opts.repo });
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  program
    .command('benchmark')
    .description('Benchmark writer models: run initial scan then test each writer one iteration.')
    .argument('<path>', 'path to scan and fix')
    .option('-c, --config <file>', 'config file', '.secure-review.yml')
    .option('-o, --output-dir <dir>', 'output directory', './reports')
    .action(async (path: string, opts: { config: string; outputDir: string }) => {
      try {
        const { config, configDir } = await loadConfig(opts.config);
        const env = loadEnv();
        const output = await runBenchmarkMode({ root: resolve(path), config, configDir, env });

        const stamp = timestamp();
        const mdPath = resolve(opts.outputDir, `benchmark-${stamp}.md`);
        const report = renderBenchmarkReport(output);
        await writeFileSafe(mdPath, report);

        log.success(`Benchmark report: ${mdPath}`);
        log.info(`\n${report}`);
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  program
    .command('compare')
    .description('Compare security findings between two paths side-by-side.')
    .argument('<path-a>', 'first path to review')
    .argument('<path-b>', 'second path to review')
    .option('-c, --config <file>', 'config file', '.secure-review.yml')
    .option('-o, --output-dir <dir>', 'output directory', './reports')
    .action(async (pathA: string, pathB: string, opts: { config: string; outputDir: string }) => {
      try {
        const { config, configDir } = await loadConfig(opts.config);
        const env = loadEnv();
        const output = await runCompareMode({
          rootA: resolve(pathA),
          rootB: resolve(pathB),
          config,
          configDir,
          env,
        });

        const stamp = timestamp();
        const mdPath = resolve(opts.outputDir, `compare-${stamp}.md`);
        const report = renderCompareReport(output);
        await writeFileSafe(mdPath, report);

        log.success(`Compare report: ${mdPath}`);
        log.info(`Delta: B is ${output.delta} vs A`);
        log.info(
          `  A: ${output.outputA.findings.length} findings, B: ${output.outputB.findings.length} findings`,
        );
        log.info(
          `  Common: ${output.common.length}, Unique to A: ${output.uniqueToA.length}, Unique to B: ${output.uniqueToB.length}`,
        );
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  program
    .command('reviewer-benchmark')
    .description('Benchmark single-model vs combined multi-model reviewer — shows what each model misses')
    .argument('<path>', 'directory to review')
    .option('-c, --config <file>', 'config file', '.secure-review.yml')
    .option('-o, --output-dir <dir>', 'output directory for reports', './reports')
    .action(async (scanPath: string, opts: { config: string; outputDir: string }) => {
      try {
        const { config, configDir } = await loadConfig(opts.config);
        const env = loadEnv();
        const stamp = timestamp();
        const output = await runReviewerBenchmark({
          root: resolve(scanPath),
          config,
          configDir,
          env,
        });
        const md = renderReviewerBenchmarkReport(output);
        const mdPath = resolve(opts.outputDir, `reviewer-benchmark-${stamp}.md`);
        await writeFileSafe(mdPath, md);
        log.success(`Reviewer benchmark report: ${mdPath}`);
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // When running inside GitHub Actions with no explicit subcommand, default to `pr`.
  // The action.yml runs this entry with inputs mapped to env vars but no argv
  // subcommand — without this shim the CLI would print --help and exit.
  const argv = [...process.argv];
  const inRunner = process.env.GITHUB_ACTIONS === 'true';
  const hasSubcommand = argv.slice(2).some((a) =>
    [
      'review',
      'fix',
      'pr',
      'scan',
      'help',
      'benchmark',
      'compare',
      'reviewer-benchmark',
      'baseline',
      'estimate',
      'init',
      'setup-secrets',
    ].includes(a),
  );
  if (inRunner && !hasSubcommand) {
    const mode = (process.env.INPUT_MODE ?? 'review').toLowerCase();
    argv.push('pr');
    if (mode === 'fix') argv.push('--autofix');
    const configInput = process.env.INPUT_CONFIG;
    if (configInput) argv.push('--config', configInput);
    const maxCostInput = process.env.INPUT_MAX_COST_USD;
    if (maxCostInput) argv.push('--max-cost-usd', maxCostInput);
  }

  await program.parseAsync(argv);
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(modulePath);
  } catch {
    return resolve(process.argv[1]) === modulePath;
  }
}

if (isDirectExecution()) {
  main().catch((err) => {
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
