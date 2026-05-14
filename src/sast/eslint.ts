import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Finding } from '../findings/schema.js';

export interface EslintResult {
  available: boolean;
  findings: Finding[];
  error?: string;
}

/** Filenames ESLint v9 recognizes as flat config. */
const ESLINT_CONFIG_NAMES = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs'] as const;

/**
 * Check whether an ESLint flat config exists at or above the scan root.
 * ESLint v9 searches up the directory tree, so we mirror that briefly:
 * check the scan root and its parents up to filesystem root. This avoids
 * dumping the v9 "no configuration found" migration wall when the target
 * project simply hasn't adopted ESLint yet.
 */
function findEslintConfig(scanRoot: string): string | undefined {
  let dir: string;
  try {
    dir = statSync(scanRoot).isDirectory() ? scanRoot : dirname(scanRoot);
  } catch {
    return undefined;
  }
  let last = '';
  while (dir && dir !== last) {
    for (const name of ESLINT_CONFIG_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    last = dir;
    dir = dirname(dir);
  }
  return undefined;
}

/**
 * Runs ESLint with the target project's flat config (eslint.config.{js,mjs,cjs}).
 * Returns `available: false` with a one-line reason if no config is reachable
 * from the scan root, instead of dumping ESLint v9's wall-of-text migration
 * message. Also returns `available: false` if eslint itself isn't installed.
 */
export async function runEslint(path: string, reviewerName = 'eslint'): Promise<EslintResult> {
  if (!findEslintConfig(path)) {
    return {
      available: false,
      findings: [],
      error: 'no eslint.config.{js,mjs,cjs} found — install ESLint v9+ and add a flat config to enable',
    };
  }
  const args = ['--format', 'json', path];
  try {
    const { stdout, exitCode, stderr } = await run('npx', ['--no-install', 'eslint', ...args]);
    // ESLint exits 1 when lint errors are present — fine.
    if (exitCode !== 0 && exitCode !== 1) {
      return { available: false, findings: [], error: stderr.trim() };
    }
    const parsed = JSON.parse(stdout) as Array<{
      filePath: string;
      messages: Array<{ ruleId?: string | null; severity: number; message: string; line: number; endLine?: number }>;
    }>;
    const findings: Finding[] = [];
    let idx = 1;
    for (const file of parsed) {
      for (const msg of file.messages) {
        findings.push({
          id: `ES-${String(idx).padStart(2, '0')}`,
          severity: msg.severity === 2 ? 'MEDIUM' : 'LOW',
          file: file.filePath,
          lineStart: msg.line,
          lineEnd: msg.endLine ?? msg.line,
          title: msg.ruleId ?? 'eslint',
          description: msg.message,
          reportedBy: [reviewerName],
          confidence: 0.4,
        });
        idx += 1;
      }
    }
    return { available: true, findings };
  } catch (err) {
    return { available: false, findings: [], error: err instanceof Error ? err.message : String(err) };
  }
}

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => rejectPromise(err));
    child.on('close', (code) => resolvePromise({ stdout, stderr, exitCode: code ?? 0 }));
  });
}
