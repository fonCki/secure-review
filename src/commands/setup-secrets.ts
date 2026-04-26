/**
 * `secure-review setup-secrets` — sets the API keys from your local `.env`
 * as GitHub Actions secrets via the `gh` CLI.
 *
 * Why this exists: anyone running the tool in CI needs the same set of
 * provider keys configured as GitHub secrets, and most users do this by
 * clicking through the GitHub web UI one-by-one. With `gh` already
 * installed and authenticated, the tool can do it in one command.
 *
 * Behavior:
 *   - Reads which providers are enabled from `.secure-review.yml`
 *   - For each enabled provider, looks up the corresponding `*_API_KEY`
 *     from `process.env` (auto-loaded from `.env` by the CLI shim)
 *   - Pipes the value to `gh secret set <NAME>` via stdin (so the secret
 *     never appears on a shell command line / process list)
 *   - Skips silently for any key that's missing or looks like a placeholder
 *
 * If `gh` isn't installed or the user isn't authenticated, prints the
 * manual fallback (`gh secret set NAME` instructions / web UI URL) and exits.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as YAML from 'js-yaml';
import { log } from '../util/logger.js';

export interface SetupSecretsOptions {
  /** Override repo (default: gh detects from current git remote). e.g. `--repo fonCki/foo` */
  repo?: string;
  /** Path to .secure-review.yml */
  config?: string;
}

interface ParsedConfig {
  writer?: { provider?: string };
  reviewers?: Array<{ provider?: string }>;
}

const PROVIDER_ENV_KEY: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
};

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^sk-ant-\.\.\.$/,
  /^sk-\.\.\.$/,
  /^AIza\.\.\.$/,
  /^dummy$/i,
  /^placeholder$/i,
  /^changeme$/i,
];

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(value));
}

function ghSecretSet(name: string, value: string, repo?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['secret', 'set', name];
    if (repo) args.push('--repo', repo);
    // Pipe the value via stdin — never appears on the command line / in `ps`.
    const proc = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`gh exited ${code}: ${stderr.trim()}`));
      }
    });
    proc.stdin.write(value);
    proc.stdin.end();
  });
}

function ghOk(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('gh', args, { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('exit', (code) => resolve(code === 0));
  });
}

function manualFallbackHint(repo: string | undefined): void {
  log.info('');
  log.info('Manual setup (without gh CLI):');
  log.info('  Option 1 — gh CLI later:');
  log.info('    gh secret set ANTHROPIC_API_KEY   # paste when prompted');
  log.info('    gh secret set OPENAI_API_KEY');
  log.info('    gh secret set GOOGLE_API_KEY');
  log.info('  Option 2 — GitHub web UI:');
  if (repo) {
    log.info(`    https://github.com/${repo}/settings/secrets/actions`);
  } else {
    log.info('    https://github.com/<owner>/<repo>/settings/secrets/actions');
  }
  log.info('');
  log.info(
    'You only need to set secrets for providers you actually use. One key (e.g. OPENAI_API_KEY only) is fine — secure-review runs with as few as 1 reader.',
  );
}

export async function runSetupSecrets(opts: SetupSecretsOptions = {}): Promise<void> {
  // 1) gh installed?
  if (!(await ghOk(['--version']))) {
    log.error('GitHub CLI (gh) not found.');
    log.info('Install: https://cli.github.com/');
    manualFallbackHint(opts.repo);
    process.exit(1);
  }

  // 2) gh authenticated?
  if (!(await ghOk(['auth', 'status']))) {
    log.error('Not logged in to GitHub. Run: gh auth login');
    manualFallbackHint(opts.repo);
    process.exit(1);
  }

  // 3) Load config to figure out which providers are enabled
  const configPath = opts.config ?? '.secure-review.yml';
  let config: ParsedConfig;
  try {
    const raw = await readFile(configPath, 'utf8');
    config = YAML.load(raw) as ParsedConfig;
  } catch (err) {
    log.error(`Could not read ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
    log.info('Run `secure-review init` first to generate a config.');
    process.exit(1);
  }

  const enabledProviders = new Set<string>();
  for (const r of config.reviewers ?? []) {
    if (r.provider) enabledProviders.add(r.provider);
  }
  if (config.writer?.provider) enabledProviders.add(config.writer.provider);

  if (enabledProviders.size === 0) {
    log.error(`No providers found in ${configPath} (no reviewers and no writer.provider).`);
    process.exit(1);
  }

  log.header(`Setting GitHub secrets${opts.repo ? ` on ${opts.repo}` : ' (auto-detected repo)'}`);

  // 4) Set each enabled provider's secret
  let setCount = 0;
  let skipCount = 0;
  let failCount = 0;
  for (const provider of enabledProviders) {
    const envKey = PROVIDER_ENV_KEY[provider];
    if (!envKey) {
      log.warn(`Unknown provider "${provider}" — no env-key mapping; skipping.`);
      continue;
    }
    const value = process.env[envKey];
    if (!value || isPlaceholder(value)) {
      log.warn(
        `${envKey}: ${value ? 'looks like a placeholder' : 'not set in environment'} — skipping.`,
      );
      skipCount += 1;
      continue;
    }
    try {
      await ghSecretSet(envKey, value, opts.repo);
      log.success(`${envKey}: set on GitHub`);
      setCount += 1;
    } catch (err) {
      log.error(`${envKey}: failed — ${err instanceof Error ? err.message : String(err)}`);
      failCount += 1;
    }
  }

  log.info('');
  log.info(`Summary: ${setCount} set · ${skipCount} skipped · ${failCount} failed`);
  log.info('Verify with: gh secret list');
  if (failCount > 0) process.exit(2);
}
