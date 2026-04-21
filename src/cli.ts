#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { loadConfig, loadEnv } from './config/load.js';
import { runReviewMode } from './modes/review.js';
import { runFixMode } from './modes/fix.js';
import { renderReviewReport, renderFixReport } from './reporters/markdown.js';
import { renderReviewEvidence, renderFixEvidence } from './reporters/json.js';
import { postPrReview } from './reporters/github-pr.js';
import { writeFileSafe } from './util/files.js';
import { log, setQuiet, setVerbose } from './util/logger.js';

async function readPackageVersion(): Promise<string> {
  const pkgPath = resolve(process.cwd(), 'package.json');
  try {
    const meta = JSON.parse(await readFile(pkgPath, 'utf8')) as { version?: string };
    return meta.version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
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

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const mdPath = resolve(opts.outputDir, `review-${stamp}.md`);
        const jsonPath = resolve(opts.outputDir, `review-${stamp}.json`);
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
    .option('--max-iterations <n>', 'override max iterations')
    .option('--max-cost-usd <n>', 'override cost cap')
    .option('--task-id <id>', 'task identifier for evidence JSON', 'unknown')
    .option('--run <n>', 'run number', '1')
    .action(
      async (
        path: string,
        opts: { config: string; outputDir: string; maxIterations?: string; maxCostUsd?: string; taskId: string; run: string },
      ) => {
        try {
          const { config, configDir } = await loadConfig(opts.config);
          const env = loadEnv();
          if (opts.maxIterations) config.fix.max_iterations = Number(opts.maxIterations);
          if (opts.maxCostUsd) config.gates.max_cost_usd = Number(opts.maxCostUsd);
          const output = await runFixMode({ root: resolve(path), config, configDir, env });

          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const mdPath = resolve(opts.outputDir, `fix-${stamp}.md`);
          const jsonPath = resolve(opts.outputDir, `fix-${stamp}.json`);
          await writeFileSafe(mdPath, renderFixReport(output));
          const evidence = renderFixEvidence(output, {
            taskId: opts.taskId,
            run: Number(opts.run),
            modelVersion: `${config.writer.model}|${config.reviewers.map((r) => r.model).join('+')}`,
            reviewerNames: config.reviewers.map((r) => r.name),
          });
          await writeFileSafe(jsonPath, JSON.stringify(evidence, null, 2));

          log.success(`Report:    ${mdPath}`);
          log.success(`Findings:  ${jsonPath}`);
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
    .option('--autofix', 'apply fixes and commit to a PR branch', false)
    .action(async (opts: { config: string; autofix: boolean }) => {
      try {
        const { config, configDir } = await loadConfig(opts.config);
        const env = loadEnv();

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
        const filesResp = await octokit.pulls.listFiles({
          owner,
          repo,
          pull_number: pr.number,
          per_page: 300,
        });
        const changedFiles = new Set(filesResp.data.map((f) => f.filename));
        log.info(`PR #${pr.number} — ${changedFiles.size} changed files`);

        const output = await runReviewMode({
          root: process.cwd(),
          config,
          configDir,
          env,
        });

        await postPrReview(output, {
          owner,
          repo,
          prNumber: pr.number,
          commitSha: pr.head.sha,
          token,
          changedFiles,
        });

        const inScope = output.findings.filter((f) => changedFiles.has(f.file));
        const criticalInScope = inScope.filter((f) => f.severity === 'CRITICAL').length;
        if (config.gates.block_on_new_critical && criticalInScope > 0) {
          log.error(`${criticalInScope} CRITICAL finding(s) on changed files — failing check`);
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

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
