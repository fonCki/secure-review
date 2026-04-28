#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// Auto-load .env from CWD if present. Saves users from
// 'set -a; source .env; set +a' before every invocation.
// process.loadEnvFile is a built-in Node 20.12+ API — no extra dependency.
if (existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // older Node, or malformed .env — fall back silently
  }
}
import { Command, InvalidArgumentError } from 'commander';
import { loadConfig, loadEnv } from './config/load.js';
import { runReviewMode } from './modes/review.js';
import { runFixMode } from './modes/fix.js';
import { renderReviewReport, renderFixReport } from './reporters/markdown.js';
import { renderReviewEvidence, renderFixEvidence } from './reporters/json.js';
import { evaluatePrGates, postPrReview } from './reporters/github-pr.js';
import { writeFileSafe } from './util/files.js';
import { log, setQuiet, setVerbose } from './util/logger.js';

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

function applyMaxCostOverride(config: Awaited<ReturnType<typeof loadConfig>>['config'], value?: number): void {
  if (value === undefined) return;
  config.gates.max_cost_usd = value;
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
      const meta = JSON.parse(await readFile(candidate, 'utf8')) as { name?: string; version?: string };
      if (meta.name === 'secure-review' && meta.version) return meta.version;
    } catch {
      // try next
    }
  }
  return '0.0.0';
}

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
    .command('review')
    .description('Run multi-model review on a path. Posts no changes.')
    .argument('<path>', 'path to review')
    .option('-c, --config <file>', 'config file', '.secure-review.yml')
    .option('-o, --output-dir <dir>', 'output directory', './reports')
    .option('--task-id <id>', 'task identifier for evidence JSON', 'unknown')
    .option('--run <n>', 'run number', '1')
    .action(async (path: string, opts: { config: string; outputDir: string; taskId: string; run: string }) => {
      try {
        const { config, configDir } = await loadConfig(opts.config);
        const env = loadEnv();
        const output = await runReviewMode({ root: resolve(path), config, configDir, env });
        enforceReviewHealth(output);

        const stamp = timestamp();
        const mdPath = outputPath(
          config.output.report,
          DEFAULT_OUTPUT.report,
          opts.outputDir,
          `review-${stamp}.md`,
          stamp,
        );
        const jsonPath = outputPath(
          config.output.findings,
          DEFAULT_OUTPUT.findings,
          opts.outputDir,
          `review-${stamp}.json`,
          stamp,
        );
        await writeFileSafe(mdPath, renderReviewReport(output));
        const evidence = renderReviewEvidence(output, {
          taskId: opts.taskId,
          run: Number(opts.run),
          modelVersion: config.reviewers.map((r) => r.model).join('+'),
          reviewerNames: config.reviewers.map((r) => r.name),
        });
        await writeFileSafe(jsonPath, JSON.stringify(evidence, null, 2));

        log.success(`Report:    ${mdPath}`);
        log.success(`Findings:  ${jsonPath}`);
        log.info(`Total: ${output.findings.length} findings · $${output.totalCostUSD.toFixed(3)}`);
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
    .option('--max-iterations <n>', 'override max iterations', parseMaxIterations)
    .option('--max-cost-usd <n>', 'override cost cap', parseMaxCostUsd)
    .option('--task-id <id>', 'task identifier for evidence JSON', 'unknown')
    .option('--run <n>', 'run number', '1')
    .action(
      async (
        path: string,
        opts: { config: string; outputDir: string; maxIterations?: number; maxCostUsd?: number; taskId: string; run: string },
      ) => {
        try {
          const { config, configDir } = await loadConfig(opts.config);
          const env = loadEnv();
          if (opts.maxIterations !== undefined) config.fix.max_iterations = opts.maxIterations;
          applyMaxCostOverride(config, opts.maxCostUsd);
          const output = await runFixMode({ root: resolve(path), config, configDir, env });
          enforceReviewHealth(output);

          const stamp = timestamp();
          const mdPath = outputPath(
            config.output.report,
            DEFAULT_OUTPUT.report,
            opts.outputDir,
            `fix-${stamp}.md`,
            stamp,
          );
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
          const evidence = renderFixEvidence(output, {
            taskId: opts.taskId,
            run: Number(opts.run),
            modelVersion: `${config.writer.model}|${config.reviewers.map((r) => r.model).join('+')}`,
            reviewerNames: config.reviewers.map((r) => r.name),
          });
          await writeFileSafe(jsonPath, JSON.stringify(evidence, null, 2));
          await writeFileSafe(diffPath, await readGitDiff(resolve(path)));

          log.success(`Report:    ${mdPath}`);
          log.success(`Findings:  ${jsonPath}`);
          log.success(`Diff:      ${diffPath}`);
          log.info(
            `Initial: ${output.initialFindings.length}  Final: ${output.finalFindings.length}  Resolved: ${evidence.findings_resolved} (${evidence.resolution_rate_pct}%)  Introduced: ${evidence.new_findings_introduced}  Cost: $${output.totalCostUSD.toFixed(3)}`,
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
    .description('GitHub Action entrypoint — review PR and post line-anchored comments.')
    .option('-c, --config <file>', 'config file', '.secure-review.yml')
    .option('--autofix', 'deprecated no-op; PR entrypoint always runs review mode', false)
    .option('--max-cost-usd <n>', 'override cost cap', parseMaxCostUsd)
    .action(async (opts: { config: string; autofix: boolean; maxCostUsd?: number }) => {
      try {
        const { config, configDir } = await loadConfig(opts.config);
        const env = loadEnv();
        applyMaxCostOverride(config, opts.maxCostUsd);
        if (opts.autofix) {
          log.warn('PR autofix mode is deprecated and currently a no-op; running review mode.');
        }

        const eventPath = process.env.GITHUB_EVENT_PATH;
        if (!eventPath) throw new Error('GITHUB_EVENT_PATH not set — `pr` subcommand requires GitHub Actions context');
        const event = JSON.parse(await readFile(eventPath, 'utf8')) as {
          pull_request?: {
            number: number;
            head: { sha: string; repo?: { fork?: boolean } };
            base: { sha: string; ref: string };
          };
          repository?: { owner?: { login?: string }; name?: string };
        };
        if (!event.pull_request) throw new Error('Event is not a pull_request event');
        const pr = event.pull_request;

        if (pr.head.repo?.fork) {
          log.warn('PR is from a fork; secrets not exposed. Skipping review.');
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

  // When running inside GitHub Actions with no explicit subcommand, default to `pr`.
  // The action.yml runs this entry with inputs mapped to env vars but no argv
  // subcommand — without this shim the CLI would print --help and exit.
  const argv = [...process.argv];
  const inRunner = process.env.GITHUB_ACTIONS === 'true';
  const hasSubcommand = argv.slice(2).some((a) => ['review', 'fix', 'pr', 'scan', 'help'].includes(a));
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
