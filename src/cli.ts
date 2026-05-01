#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

// Auto-load .env from CWD if present. Saves users from
// 'set -a; source .env; set +a' before every invocation.
// process.loadEnvFile is a built-in Node 20.12+ API — no extra dependency.
// Security: .env files should be restricted to mode 600 and listed in .gitignore.
if (existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // older Node, or malformed .env — fall back silently
  }
}
import { Command, InvalidArgumentError } from 'commander';
import { z } from 'zod';
import { loadConfig, loadEnv } from './config/load.js';
import { runReviewMode } from './modes/review.js';
import { runFixMode } from './modes/fix.js';
import { runAttackMode } from './modes/attack.js';
import { runAttackAiMode, mergeAttackerRef } from './modes/attack-ai.js';
import { ghActionInput } from './pentest/gh-action-inputs.js';
import { runBrowserLoginScript } from './pentest/browser-login.js';
import { parsePentestScannerList, runCliPentestScanners } from './pentest/cli-scanners.js';
import { runBenchmarkMode, renderBenchmarkReport } from './modes/benchmark.js';
import { runCompareMode, renderCompareReport } from './modes/compare.js';
import { runReviewerBenchmark, renderReviewerBenchmarkReport } from './modes/reviewer-benchmark.js';
import { renderReviewReport, renderFixReport, renderAttackReport, renderAttackAiReport } from './reporters/markdown.js';
import { renderReviewHtml, renderFixHtml } from './reporters/html.js';
import { renderReviewEvidence, renderFixEvidence, renderAttackEvidence, renderAttackAiEvidence } from './reporters/json.js';
import {
  evaluatePrGates,
  evaluateRuntimePrGate,
  postPrMarkdownReview,
  postPrReview,
} from './reporters/github-pr.js';
import { writeFileSafe, getGitChangedFiles, readSourceTree } from './util/files.js';
import {
  DEFAULT_BASELINE_FILENAME,
  baselineFromFindings,
  loadBaseline,
  mergeBaseline,
  saveBaseline,
} from './findings/baseline.js';
import { FindingSchema, type Finding } from './findings/schema.js';
import { severityBreakdown } from './findings/aggregate.js';
import { log, setQuiet, setVerbose } from './util/logger.js';
import {
  estimateRunCost,
  formatEstimateText,
  type EstimateMode,
} from './util/estimate-cost.js';
import { DynamicCheck, Provider, type DynamicCheck as DynamicCheckType } from './config/schema.js';
import { mergeAuthHeaders } from './util/request-headers.js';

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

export function parseTimeoutSeconds(raw: string): number {
  if (raw.trim() === '') throw new InvalidArgumentError('timeout must be an integer from 1 to 600 seconds');
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 600) {
    throw new InvalidArgumentError('timeout must be an integer from 1 to 600 seconds');
  }
  return n;
}

/** PR/runtime job budget for scanners + probes (GitHub Actions can run longer single steps). */
export function parseRuntimePrTimeoutSeconds(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 30 || n > 7200) {
    throw new InvalidArgumentError('runtime-timeout-seconds must be an integer from 30 to 7200');
  }
  return n;
}

export function parseMaxRequests(raw: string): number {
  if (raw.trim() === '') throw new InvalidArgumentError('max requests must be an integer from 1 to 500');
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 500) {
    throw new InvalidArgumentError('max requests must be an integer from 1 to 500');
  }
  return n;
}

export function parseMaxCrawlPages(raw: string): number {
  if (raw.trim() === '') throw new InvalidArgumentError('max crawl pages must be an integer from 1 to 100');
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw new InvalidArgumentError('max crawl pages must be an integer from 1 to 100');
  }
  return n;
}

export function parseRateLimit(raw: string): number {
  if (raw.trim() === '') throw new InvalidArgumentError('rate limit must be a number greater than 0 and at most 20');
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 20) {
    throw new InvalidArgumentError('rate limit must be a number greater than 0 and at most 20');
  }
  return n;
}

export function parseAttackProvider(raw: string) {
  const parsed = Provider.safeParse(raw.trim().toLowerCase());
  if (!parsed.success) {
    throw new InvalidArgumentError('attack provider must be anthropic, openai, or google');
  }
  return parsed.data;
}

/** Parse `Name: value` headers for authenticated Layer 4 probes (repeatable CLI `-H`). */
export function parseAuthHeaderLine(raw: string): { name: string; value: string } {
  const trimmed = raw.trim();
  const idx = trimmed.indexOf(':');
  if (idx <= 0) {
    throw new InvalidArgumentError(
      `Invalid header "${raw}": expected "Name: value" (first colon separates name from value)`,
    );
  }
  const name = trimmed.slice(0, idx).trim();
  const value = trimmed.slice(idx + 1).trim();
  if (!name) throw new InvalidArgumentError(`Invalid header "${raw}": empty header name`);
  return { name, value };
}

export function authHeadersFromCliList(lines: string[] | undefined): Record<string, string> | undefined {
  if (!lines?.length) return undefined;
  const out: Record<string, string> = {};
  for (const line of lines) {
    const { name, value } = parseAuthHeaderLine(line);
    out[name] = value;
  }
  return out;
}

/** JSON object of header names → values (CI secret / env). Values must be strings. */
export function parseAuthHeadersJson(raw: string | undefined): Record<string, string> | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string') out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/** GitHub PR review body maximum is ~65536; keep headroom for summaries. */
function capPrMarkdownBody(markdown: string, maxChars = 62_000): string {
  if (markdown.length <= maxChars) return markdown;
  return `${markdown.slice(0, maxChars - 220)}\n\n_…truncated for GitHub review body limit._\n`;
}

function resolvePrRuntimeMode(cliMode: string | undefined): 'review' | 'attack' | 'attack-ai' {
  const a = cliMode?.trim().toLowerCase();
  if (a === 'attack' || a === 'attack-ai' || a === 'review') return a;
  const b = ghActionInput('runtime-mode')?.trim().toLowerCase();
  if (b === 'attack' || b === 'attack-ai' || b === 'review') return b;
  const c = ghActionInput('mode')?.trim().toLowerCase();
  if (c === 'attack' || c === 'attack-ai' || c === 'review') return c;
  return 'review';
}

function resolveRuntimeWallSeconds(
  cliValue: number | undefined,
): number {
  if (cliValue !== undefined && Number.isFinite(cliValue)) {
    return Math.min(7200, Math.max(30, Math.trunc(cliValue)));
  }
  const g = ghActionInput('runtime-timeout-seconds');
  if (g) {
    const n = parseInt(g, 10);
    if (Number.isFinite(n)) return Math.min(7200, Math.max(30, n));
  }
  return 900;
}

/** Wall-clock budget for ZAP/Nuclei (local CLI `--pentest-scanners`). */
function resolvePentestWallSeconds(cli?: number): number {
  if (cli !== undefined && Number.isFinite(cli)) {
    return Math.min(7200, Math.max(30, Math.trunc(cli)));
  }
  const g = process.env.SECURE_REVIEW_PENTEST_TIMEOUT_SECONDS;
  if (g) {
    const n = parseInt(g.trim(), 10);
    if (Number.isFinite(n)) return Math.min(7200, Math.max(30, n));
  }
  return 900;
}

export function parseDynamicChecks(raw: string): DynamicCheckType[] {
  const checks = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (checks.length === 0) {
    throw new InvalidArgumentError('checks must be a comma-separated list');
  }
  return checks.map((check) => {
    const parsed = DynamicCheck.safeParse(check);
    if (!parsed.success) {
      throw new InvalidArgumentError(
        `unknown dynamic check '${check}' (valid: headers,cookies,cors,sensitive_paths)`,
      );
    }
    return parsed.data;
  });
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
    log.info(`Baseline: loaded ${baseline.entries.length} accepted finding(s) from ${auto}`);
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
  flags: { yes: boolean; skipEstimate: boolean; quiet: boolean },
): Promise<boolean> {
  if (flags.skipEstimate) return true;
  const files = await readSourceTree(scanRoot, 200_000);
  if (files.length === 0) {
    log.warn('No source files found under scan root — skipping cost estimate.');
    return true;
  }
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
        const proceed = await previewAndConfirmCost(root, config, 'review', {
          yes: opts.yes,
          skipEstimate: opts.estimate === false,
          quiet: program.opts<{ quiet?: boolean }>().quiet === true,
        });
        if (!proceed) {
          log.warn('Aborted by user before running review.');
          process.exit(0);
        }
        const only = opts.since ? await getGitChangedFiles(root, opts.since) : undefined;
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
    .option('--attack-target-url <url>', 'enable attack-ai during fix; runtime-confirmed findings feed the writer queue and additive convergence (uses dynamic.target_url if not set)')
    .option('--attack-every-iter', 'when attack is enabled, re-run attack-ai after every iteration (default: bookend = initial + final only)', false)
    .option('--no-attack', 'disable attack-ai phase even when --attack-target-url or dynamic.target_url is set')
    .option('--attack-max-requests <n>', 'override dynamic.max_requests for attack-ai phases', parseMaxRequests)
    .option('--attack-max-crawl-pages <n>', 'override dynamic.max_crawl_pages for attack-ai phases', parseMaxCrawlPages)
    .option('--attack-rate-limit-per-second <n>', 'override dynamic.rate_limit_per_second for attack-ai phases', parseRateLimit)
    .option('--attack-timeout-seconds <n>', 'override dynamic.timeout_seconds for attack-ai phases', parseTimeoutSeconds)
    .option('--attack-provider <p>', 'override attacker LLM provider (anthropic|openai|google)', parseAttackProvider)
    .option('--attack-model <id>', 'override attacker model id (merged with config; defaults from dynamic.attacker or writer)')
    .option('--attack-skill <path>', 'override attacker skill path (relative to config file or absolute)')
    .option(
      '--attack-header <pair>',
      'HTTP header Name: value for attack-ai phases (repeatable); merged over dynamic.auth_headers',
      (value: string, prev: string[]) => [...prev, value],
      [] as string[],
    )
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
          attackTargetUrl?: string;
          attackEveryIter: boolean;
          attack: boolean;
          attackMaxRequests?: number;
          attackMaxCrawlPages?: number;
          attackRateLimitPerSecond?: number;
          attackTimeoutSeconds?: number;
          attackProvider?: ReturnType<typeof parseAttackProvider>;
          attackModel?: string;
          attackSkill?: string;
          attackHeader: string[];
        },
      ) => {
        try {
          const { config, configDir } = await loadConfig(opts.config);
          const env = loadEnv();
          if (opts.maxIterations !== undefined) config.fix.max_iterations = opts.maxIterations;
          applyMaxCostOverride(config, opts.maxCostUsd);
          applyMaxWallTimeOverride(config, opts.maxWallTimeMinutes);
          const root = resolve(path);
          const proceed = await previewAndConfirmCost(root, config, 'fix', {
            yes: opts.yes,
            skipEstimate: opts.estimate === false,
            quiet: program.opts<{ quiet?: boolean }>().quiet === true,
          });
          if (!proceed) {
            log.warn('Aborted by user before running fix.');
            process.exit(0);
          }
          const only = opts.since ? await getGitChangedFiles(root, opts.since) : undefined;
          if (only) log.info(`Incremental mode: ${only.size} file${only.size === 1 ? '' : 's'} changed since ${opts.since}`);
          const { baseline } = await resolveBaseline(root, opts.baseline);
          const attackTarget = opts.attack === false ? undefined : (opts.attackTargetUrl ?? config.dynamic.target_url);
          const attackHook = attackTarget
            ? {
                targetUrl: attackTarget,
                cadence: opts.attackEveryIter ? ('every' as const) : ('bookend' as const),
                timeoutSeconds: opts.attackTimeoutSeconds,
                maxRequests: opts.attackMaxRequests,
                maxCrawlPages: opts.attackMaxCrawlPages,
                rateLimitPerSecond: opts.attackRateLimitPerSecond,
                attackerProvider: opts.attackProvider,
                attackerModel: opts.attackModel,
                attackerSkillPath: opts.attackSkill,
                authHeaders: authHeadersFromCliList(opts.attackHeader),
              }
            : undefined;
          if (attackHook) {
            const merged = mergeAttackerRef({
              root,
              config,
              configDir,
              env,
              attackerProvider: attackHook.attackerProvider,
              attackerModel: attackHook.attackerModel,
              attackerSkillPath: attackHook.attackerSkillPath,
            });
            log.info(
              `Attack-ai enabled: target=${attackHook.targetUrl} · cadence=${attackHook.cadence} · attacker=${merged.provider}/${merged.model}`,
            );
          }
          const output = await runFixMode({ root, config, configDir, env, only, baseline, attack: attackHook });
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
          const runtimeNote = output.runtimeAttacks
            ? `  Runtime: ${output.initialRuntimeFindings?.length ?? 0} → ${output.finalRuntimeFindings?.length ?? output.initialRuntimeFindings?.length ?? 0} confirmed`
            : '';
          log.info(
            `Initial: ${output.initialFindings.length}  Final: ${output.finalFindings.length}  Resolved: ${evidence.findings_resolved} (${evidence.resolution_rate_pct}%)  Introduced: ${evidence.new_findings_introduced}${baselineNote}${runtimeNote}  Cost: $${output.totalCostUSD.toFixed(3)}`,
          );
          if (output.gateBlocked) process.exit(2);
        } catch (err) {
          log.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  program
    .command('attack')
    .description('Run Layer 4 deterministic runtime probes against a live target URL.')
    .argument('[path]', 'project root for config resolution', '.')
    .option('-c, --config <file>', 'config file', '.secure-review.yml')
    .option('-o, --output-dir <dir>', 'output directory', './reports')
    .option('--target-url <url>', 'runtime target URL (overrides dynamic.target_url)')
    .option('--checks <list>', 'comma-separated dynamic checks: headers,cookies,cors,sensitive_paths', parseDynamicChecks)
    .option('--timeout-seconds <n>', 'per-request timeout in seconds', parseTimeoutSeconds)
    .option(
      '-H, --header <pair>',
      'HTTP header Name: value on every probe (repeatable); merged over dynamic.auth_headers',
      (value: string, prev: string[]) => [...prev, value],
      [] as string[],
    )
    .option(
      '--pentest-scanners <list>',
      'after built-in probes run ZAP baseline (Docker) and/or nuclei — comma: zap-baseline,nuclei',
    )
    .option(
      '--browser-login-script <path>',
      'Node script printing final stdout line JSON { "headers": {} } (merged before probes + scanners)',
    )
    .option(
      '--pentest-timeout-seconds <n>',
      'wall-clock budget for ZAP/Nuclei only (30–7200; default 900)',
      parseRuntimePrTimeoutSeconds,
    )
    .option('--task-id <id>', 'task identifier for evidence JSON', 'unknown')
    .option('--run <n>', 'run number', '1')
    .action(
      async (
        path: string,
        opts: {
          config: string;
          outputDir: string;
          targetUrl?: string;
          checks?: DynamicCheckType[];
          timeoutSeconds?: number;
          header: string[];
          pentestScanners?: string;
          browserLoginScript?: string;
          pentestTimeoutSeconds?: number;
          taskId: string;
          run: string;
        },
      ) => {
        try {
          const wallStarted = Date.now();
          const { config } = await loadConfig(opts.config);
          const rootResolved = resolve(path);
          let authHeaders = mergeAuthHeaders(
            config.dynamic.auth_headers,
            mergeAuthHeaders(
              parseAuthHeadersJson(process.env.SECURE_REVIEW_AUTH_HEADERS_JSON),
              authHeadersFromCliList(opts.header),
            ),
          );
          if (opts.browserLoginScript) {
            const hook = runBrowserLoginScript(opts.browserLoginScript, rootResolved);
            authHeaders = mergeAuthHeaders(authHeaders, hook.headers);
          }

          const output = await runAttackMode({
            root: rootResolved,
            config,
            targetUrl: opts.targetUrl,
            checks: opts.checks,
            timeoutSeconds: opts.timeoutSeconds,
            authHeaders: authHeaders ?? undefined,
          });
          const stamp = timestamp();
          const mdPath = outputPath(
            config.output.report,
            DEFAULT_OUTPUT.report,
            opts.outputDir,
            `attack-${stamp}.md`,
            stamp,
          );
          const jsonPath = outputPath(
            config.output.findings,
            DEFAULT_OUTPUT.findings,
            opts.outputDir,
            `attack-${stamp}.json`,
            stamp,
          );

          const kinds = parsePentestScannerList(opts.pentestScanners);
          let appendix = '';
          let scannerFindings: Finding[] = [];
          if (kinds.length > 0) {
            log.info(
              `External scanners: ${kinds.join(', ')} (wall budget ${resolvePentestWallSeconds(opts.pentestTimeoutSeconds)}s)`,
            );
            const wallMs = resolvePentestWallSeconds(opts.pentestTimeoutSeconds) * 1000;
            const pentest = await runCliPentestScanners(kinds, output.targetUrl, wallMs);
            appendix = pentest.appendixMarkdown;
            scannerFindings = pentest.findings;
          }

          const mergedFindings = [...output.findings, ...scannerFindings];
          const mergedBreakdown = severityBreakdown(mergedFindings);
          const scannerGate = evaluateRuntimePrGate(mergedFindings, config.dynamic.gates);
          const gateBlockedFinal = output.gateBlocked || scannerGate.blocked;
          const gateReasonsFinal = [...output.gateReasons];
          for (const r of scannerGate.reasons) {
            if (!gateReasonsFinal.includes(r)) gateReasonsFinal.push(r);
          }

          await writeFileSafe(
            mdPath,
            renderAttackReport(output) +
              (appendix ? `\n\n---\n\n## External scanners (ZAP / Nuclei)\n${appendix}` : ''),
          );

          const evidence = renderAttackEvidence(output, {
            taskId: opts.taskId,
            run: Number(opts.run),
            modelVersion: 'dynamic-runtime',
            reviewerNames: ['dynamic'],
          });
          const evidenceOut = {
            ...evidence,
            findings: mergedFindings,
            runtime_findings: mergedFindings,
            findings_by_severity_initial: mergedBreakdown,
            findings_by_severity_after_fix: mergedBreakdown,
            total_findings_initial: mergedFindings.length,
            total_findings_after_fix: mergedFindings.length,
            gate_blocked: gateBlockedFinal,
            gate_reasons: gateReasonsFinal,
            notes: gateBlockedFinal ? `Gate blocked: ${gateReasonsFinal.join('; ')}` : evidence.notes,
          };
          await writeFileSafe(jsonPath, JSON.stringify(evidenceOut, null, 2));

          log.success(`Report:    ${mdPath}`);
          log.success(`Findings:  ${jsonPath}`);
          const wallClockS = (Date.now() - wallStarted) / 1000;
          log.info(
            `Runtime findings: ${output.findings.length} (+ ${scannerFindings.length} from scanners)  Gate: ${gateBlockedFinal ? 'BLOCKED' : 'passed'}  Duration: ${wallClockS.toFixed(1)}s`,
          );
          if (gateBlockedFinal) process.exit(2);
        } catch (err) {
          log.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  program
    .command('attack-ai')
    .description('Run authorized AI-planned, same-origin runtime probes against a live target URL.')
    .argument('[path]', 'project root for source context and config resolution', '.')
    .option('-c, --config <file>', 'config file', '.secure-review.yml')
    .option('-o, --output-dir <dir>', 'output directory', './reports')
    .option('--target-url <url>', 'runtime target URL (overrides dynamic.target_url)')
    .option('--timeout-seconds <n>', 'per-request timeout in seconds', parseTimeoutSeconds)
    .option('--max-requests <n>', 'maximum total runtime HTTP requests', parseMaxRequests)
    .option('--max-crawl-pages <n>', 'maximum same-origin pages to crawl', parseMaxCrawlPages)
    .option('--rate-limit-per-second <n>', 'maximum HTTP request rate', parseRateLimit)
    .option('--attack-provider <p>', 'override attacker LLM provider (anthropic|openai|google)', parseAttackProvider)
    .option('--attack-model <id>', 'override attacker model id (defaults from dynamic.attacker or writer)')
    .option('--attack-skill <path>', 'override attacker skill path (relative to config file or absolute)')
    .option(
      '-H, --header <pair>',
      'HTTP header Name: value on crawl/probes (repeatable); merged over dynamic.auth_headers',
      (value: string, prev: string[]) => [...prev, value],
      [] as string[],
    )
    .option(
      '--pentest-scanners <list>',
      'after attack-ai run ZAP baseline (Docker) and/or nuclei — comma: zap-baseline,nuclei',
    )
    .option(
      '--browser-login-script <path>',
      'Node script printing final stdout line JSON { "headers": {} }',
    )
    .option(
      '--pentest-timeout-seconds <n>',
      'wall-clock budget for ZAP/Nuclei only (30–7200; default 900)',
      parseRuntimePrTimeoutSeconds,
    )
    .option('--task-id <id>', 'task identifier for evidence JSON', 'unknown')
    .option('--run <n>', 'run number', '1')
    .action(
      async (
        path: string,
        opts: {
          config: string;
          outputDir: string;
          targetUrl?: string;
          timeoutSeconds?: number;
          maxRequests?: number;
          maxCrawlPages?: number;
          rateLimitPerSecond?: number;
          attackProvider?: ReturnType<typeof parseAttackProvider>;
          attackModel?: string;
          attackSkill?: string;
          header: string[];
          pentestScanners?: string;
          browserLoginScript?: string;
          pentestTimeoutSeconds?: number;
          taskId: string;
          run: string;
        },
      ) => {
        try {
          const wallStarted = Date.now();
          const { config, configDir } = await loadConfig(opts.config);
          const env = loadEnv();
          const root = resolve(path);
          let authHeaders = mergeAuthHeaders(
            config.dynamic.auth_headers,
            mergeAuthHeaders(
              parseAuthHeadersJson(process.env.SECURE_REVIEW_AUTH_HEADERS_JSON),
              authHeadersFromCliList(opts.header),
            ),
          );
          if (opts.browserLoginScript) {
            authHeaders = mergeAuthHeaders(authHeaders, runBrowserLoginScript(opts.browserLoginScript, root).headers);
          }

          const output = await runAttackAiMode({
            root,
            config,
            configDir,
            env,
            targetUrl: opts.targetUrl,
            timeoutSeconds: opts.timeoutSeconds,
            maxRequests: opts.maxRequests,
            maxCrawlPages: opts.maxCrawlPages,
            rateLimitPerSecond: opts.rateLimitPerSecond,
            attackerProvider: opts.attackProvider,
            attackerModel: opts.attackModel,
            attackerSkillPath: opts.attackSkill,
            authHeaders: authHeaders ?? undefined,
          });
          const stamp = timestamp();
          const mdPath = outputPath(
            config.output.report,
            DEFAULT_OUTPUT.report,
            opts.outputDir,
            `attack-ai-${stamp}.md`,
            stamp,
          );
          const jsonPath = outputPath(
            config.output.findings,
            DEFAULT_OUTPUT.findings,
            opts.outputDir,
            `attack-ai-${stamp}.json`,
            stamp,
          );

          const kinds = parsePentestScannerList(opts.pentestScanners);
          let appendix = '';
          let scannerFindings: Finding[] = [];
          if (kinds.length > 0) {
            log.info(
              `External scanners: ${kinds.join(', ')} (wall budget ${resolvePentestWallSeconds(opts.pentestTimeoutSeconds)}s)`,
            );
            const wallMs = resolvePentestWallSeconds(opts.pentestTimeoutSeconds) * 1000;
            const pentest = await runCliPentestScanners(kinds, output.targetUrl, wallMs);
            appendix = pentest.appendixMarkdown;
            scannerFindings = pentest.findings;
          }

          const mergedFindings = [...output.findings, ...scannerFindings];
          const mergedBreakdown = severityBreakdown(mergedFindings);
          const scannerGate = evaluateRuntimePrGate(mergedFindings, config.dynamic.gates);
          const gateBlockedFinal = output.gateBlocked || scannerGate.blocked;
          const gateReasonsFinal = [...output.gateReasons];
          for (const r of scannerGate.reasons) {
            if (!gateReasonsFinal.includes(r)) gateReasonsFinal.push(r);
          }

          await writeFileSafe(
            mdPath,
            renderAttackAiReport(output) +
              (appendix ? `\n\n---\n\n## External scanners (ZAP / Nuclei)\n${appendix}` : ''),
          );

          const evidence = renderAttackAiEvidence(output, {
            taskId: opts.taskId,
            run: Number(opts.run),
            modelVersion: `${output.attacker.provider}/${output.attacker.model}`,
            reviewerNames: ['attack-ai'],
          });
          const evidenceOut = {
            ...evidence,
            findings: mergedFindings,
            runtime_findings: mergedFindings,
            findings_by_severity_initial: mergedBreakdown,
            findings_by_severity_after_fix: mergedBreakdown,
            total_findings_initial: mergedFindings.length,
            total_findings_after_fix: mergedFindings.length,
            gate_blocked: gateBlockedFinal,
            gate_reasons: gateReasonsFinal,
            notes: gateBlockedFinal ? `Gate blocked: ${gateReasonsFinal.join('; ')}` : evidence.notes,
          };
          await writeFileSafe(jsonPath, JSON.stringify(evidenceOut, null, 2));

          log.success(`Report:    ${mdPath}`);
          log.success(`Findings:  ${jsonPath}`);
          const wallClockS = (Date.now() - wallStarted) / 1000;
          log.info(
            `AI attack findings: ${output.findings.length} (+ ${scannerFindings.length} from scanners)  Probes: ${output.probes.length}  Gate: ${gateBlockedFinal ? 'BLOCKED' : 'passed'}  Duration: ${wallClockS.toFixed(1)}s  Cost: $${output.totalCostUSD.toFixed(3)}`,
          );
          if (gateBlockedFinal) process.exit(2);
        } catch (err) {
          log.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  program
    .command('pr')
    .description(
      'GitHub Action entrypoint — static review, or runtime attack / attack-ai + optional ZAP/Nuclei.',
    )
    .option('-c, --config <file>', 'config file', '.secure-review.yml')
    .option('--autofix', 'deprecated no-op when running static review mode', false)
    .option('--max-cost-usd <n>', 'override cost cap (static review)', parseMaxCostUsd)
    .option(
      '--runtime-mode <mode>',
      'review | attack | attack-ai (or set INPUT_RUNTIME_MODE / INPUT_MODE)',
    )
    .option('--target-url <url>', 'live app URL for attack / attack-ai / external scanners')
    .option(
      '--pentest-scanners <list>',
      'comma-separated zap-baseline and/or nuclei (requires --target-url)',
    )
    .option(
      '--browser-login-script <path>',
      'Node script printing one JSON line { "headers": { ... } } before scans',
    )
    .option(
      '--runtime-timeout-seconds <n>',
      'probe + scanner wall time (30–7200s)',
      parseRuntimePrTimeoutSeconds,
    )
    .action(
      async (
        opts: {
          config: string;
          autofix: boolean;
          maxCostUsd?: number;
          runtimeMode?: string;
          targetUrl?: string;
          pentestScanners?: string;
          browserLoginScript?: string;
          runtimeTimeoutSeconds?: number;
        },
      ) => {
        try {
          const { config, configDir } = await loadConfig(opts.config);
          const env = loadEnv();
          applyMaxCostOverride(config, opts.maxCostUsd);

          const runtimeMode = resolvePrRuntimeMode(opts.runtimeMode);
          if (runtimeMode === 'review' && opts.autofix) {
            log.warn('PR autofix mode is deprecated and a no-op; running static review.');
          }
          const legacyMode = ghActionInput('mode')?.trim().toLowerCase();
          if (
            legacyMode === 'fix' &&
            runtimeMode === 'review' &&
            !ghActionInput('runtime-mode') &&
            !opts.runtimeMode
          ) {
            log.warn('INPUT mode=fix is deprecated; using static multi-model review.');
          }

          const eventPath = process.env.GITHUB_EVENT_PATH;
          if (!eventPath)
            throw new Error('GITHUB_EVENT_PATH not set — `pr` subcommand requires GitHub Actions context');
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
            `PR #${pr.number} — ${commentableLines.size} changed files, ${totalCommentable} diff-commentable lines · runtime mode: ${runtimeMode}`,
          );

          const prPostBase = {
            owner,
            repo,
            prNumber: pr.number,
            commitSha: pr.head.sha,
            token,
          };

          if (runtimeMode === 'review') {
            const output = await runReviewMode({
              root: process.cwd(),
              config,
              configDir,
              env,
            });
            enforceReviewHealth(output);

            const prResult = await postPrReview(output, {
              ...prPostBase,
              commentableLines,
            });

            const prGate = evaluatePrGates(prResult, output.totalCostUSD, config.gates);
            if (prGate.blocked) {
              log.error(`PR gate blocked: ${prGate.reasons.join('; ')}`);
              process.exit(2);
            }
            return;
          }

          const targetUrl =
            opts.targetUrl?.trim() || ghActionInput('target-url') || config.dynamic.target_url;
          if (!targetUrl) {
            throw new Error(
              '`attack` / `attack-ai` PR mode requires `target-url` (Action input, --target-url, or dynamic.target_url)',
            );
          }

          const wallSec = resolveRuntimeWallSeconds(opts.runtimeTimeoutSeconds);
          const timeoutWallMs = wallSec * 1000;
          const attackProbeSec = Math.min(600, wallSec);

          const scannerListRaw = opts.pentestScanners ?? ghActionInput('pentest-scanners');
          const browserScript = opts.browserLoginScript ?? ghActionInput('browser-login-script');

          let authHeaders = mergeAuthHeaders(
            config.dynamic.auth_headers,
            mergeAuthHeaders(
              parseAuthHeadersJson(process.env.SECURE_REVIEW_AUTH_HEADERS_JSON),
              parseAuthHeadersJson(ghActionInput('auth-headers-json')),
            ),
          );
          if (browserScript) {
            const hook = runBrowserLoginScript(browserScript, process.cwd(), Math.min(timeoutWallMs, 120_000));
            authHeaders = mergeAuthHeaders(authHeaders, hook.headers);
          }

          const aggregateFindings: import('./findings/schema.js').Finding[] = [];
          let modeGateBlocked = false;
          let body = `## Runtime security — \`${runtimeMode}\`\n\n**Target:** \`${targetUrl}\`\n\n`;

          if (runtimeMode === 'attack') {
            const attackOut = await runAttackMode({
              root: process.cwd(),
              config,
              targetUrl,
              timeoutSeconds: attackProbeSec,
              authHeaders: authHeaders ?? undefined,
            });
            modeGateBlocked = attackOut.gateBlocked;
            aggregateFindings.push(...attackOut.findings);
            body += renderAttackReport(attackOut);
          } else {
            const aiOut = await runAttackAiMode({
              root: process.cwd(),
              config,
              configDir,
              env,
              targetUrl,
              timeoutSeconds: attackProbeSec,
              authHeaders: authHeaders ?? undefined,
            });
            modeGateBlocked = aiOut.gateBlocked;
            aggregateFindings.push(...aiOut.findings);
            body += renderAttackAiReport(aiOut);
            body += `\n_Cost (attack planner): $${aiOut.totalCostUSD.toFixed(3)}_\n`;
          }

          const kinds = parsePentestScannerList(scannerListRaw);
          if (kinds.length > 0) {
            const pentest = await runCliPentestScanners(kinds, targetUrl, timeoutWallMs);
            body += pentest.appendixMarkdown;
            aggregateFindings.push(...pentest.findings);
          }

          body += `\n<sub>Generated by [secure-review](https://github.com/fonCki/secure-review) · runtime + optional external scanners</sub>`;

          await postPrMarkdownReview({
            ...prPostBase,
            bodyMarkdown: capPrMarkdownBody(body),
          });

          const combinedGate = evaluateRuntimePrGate(aggregateFindings, config.dynamic.gates);
          if (modeGateBlocked || combinedGate.blocked) {
            log.error(
              `Runtime gate blocked: ${[...(modeGateBlocked ? ['built-in dynamic gate'] : []), ...combinedGate.reasons].join('; ')}`,
            );
            process.exit(2);
          }
        } catch (err) {
          log.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  program
    .command('estimate')
    .description('Print a pre-run cost estimate without invoking any model.')
    .argument('<path>', 'path that would be reviewed/fixed')
    .option('-c, --config <file>', 'config file', '.secure-review.yml')
    .option('-m, --mode <mode>', 'estimate for `review` or `fix` mode', 'fix')
    .option('--max-iterations <n>', 'override max iterations (fix mode)', parseMaxIterations)
    .action(async (path: string, opts: { config: string; mode: string; maxIterations?: number }) => {
      try {
        const mode = opts.mode === 'review' ? 'review' : 'fix';
        if (opts.mode !== 'review' && opts.mode !== 'fix') {
          log.warn(`Unknown mode '${opts.mode}', defaulting to 'fix'`);
        }
        const { config } = await loadConfig(opts.config);
        if (opts.maxIterations !== undefined) config.fix.max_iterations = opts.maxIterations;
        const files = await readSourceTree(resolve(path), 200_000);
        if (files.length === 0) {
          log.warn('No source files found under scan root.');
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
      'attack',
      'attack-ai',
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
