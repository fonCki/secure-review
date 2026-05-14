import { beforeAll, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'tsup';

let cliPath = '';
let fakeClaude = '';

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sr-cli-exit-'));
  symlinkSync(resolve('node_modules'), join(tmp, 'node_modules'), 'dir');
  const outDir = join(tmp, 'bundle');
  await build({
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    clean: true,
    outDir,
    target: 'node20',
    shims: true,
    splitting: false,
    sourcemap: false,
    minify: false,
  });
  cliPath = join(outDir, 'cli.js');
  if (!existsSync(cliPath)) throw new Error(`Missing bundled CLI at ${cliPath}`);

  fakeClaude = join(tmp, 'fake-claude.js');
  writeFileSync(
    fakeClaude,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const model = args[args.indexOf('--model') + 1] || '';
if (model.includes('fail')) {
  console.error('mock failure for ' + model);
  process.exit(1);
}
process.stdout.write(JSON.stringify({
  result: JSON.stringify({ findings: [] }),
  usage: { input_tokens: 1, output_tokens: 1 },
  total_cost_usd: 0.001
}));
`,
  );
  chmodSync(fakeClaude, 0o755);
});

function makeFixture(models: string[]): { root: string; config: string; outputDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'sr-cli-fixture-'));
  writeFileSync(join(root, 'app.ts'), 'export const x = 1;\n');
  writeFileSync(join(root, 'reviewer.md'), '# Reviewer\n');
  const reviewers = models
    .map(
      (model) => `  - name: ${model}
    provider: anthropic
    model: ${model}
    skill: reviewer.md`,
    )
    .join('\n');
  const config = join(root, '.secure-review.yml');
  writeFileSync(
    config,
    `writer:
  provider: anthropic
  model: ok-writer
  skill: reviewer.md
reviewers:
${reviewers}
sast:
  enabled: false
  tools: []
  inject_into_reviewer_context: false
`,
  );
  return { root, config, outputDir: join(root, 'reports') };
}

function runReview(models: string[]): ReturnType<typeof spawnSync> {
  const fixture = makeFixture(models);
  const env = { ...process.env };
  delete env.GITHUB_ACTIONS;
  env.ANTHROPIC_MODE = 'cli';
  env.CLAUDE_CLI_BIN = fakeClaude;
  return spawnSync(
    process.execPath,
    [
      cliPath,
      'review',
      fixture.root,
      '--config',
      fixture.config,
      '--output-dir',
      fixture.outputDir,
    ],
    { env, encoding: 'utf8' },
  );
}

describe('CLI review exit codes for reviewer health', () => {
  it('exits 3 when all reviewers fail', () => {
    const result = runReview(['fail-a', 'fail-b']);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('Reviewers unavailable');
  });

  it('exits 0 when review is degraded', () => {
    const result = runReview(['fail-a', 'ok-b']);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Review degraded');
  });

  it('exits 0 when all reviewers succeed', () => {
    const result = runReview(['ok-a', 'ok-b']);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('Review degraded');
  });
});

describe('CLI `pr` subcommand — local-invocation guidance (papercut #5)', () => {
  it('emits a friendly error pointing at local subcommands when GITHUB_EVENT_PATH is unset', () => {
    const env = { ...process.env };
    delete env.GITHUB_ACTIONS;
    delete env.GITHUB_EVENT_PATH;
    const result = spawnSync(process.execPath, [cliPath, 'pr'], { env, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    const combined = `${result.stdout}\n${result.stderr}`;
    // Old message was a single terse line; new message points the user at the
    // right local subcommands.
    expect(combined).toMatch(/GITHUB_EVENT_PATH/);
    expect(combined).toMatch(/secure-review review/);
    expect(combined).toMatch(/secure-review scan/);
    expect(combined).toMatch(/secure-review fix/);
  });
});
