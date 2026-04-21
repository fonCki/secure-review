import { spawn } from 'node:child_process';
import type { Finding } from '../findings/schema.js';

export interface EslintResult {
  available: boolean;
  findings: Finding[];
  error?: string;
}

/**
 * Runs ESLint with eslint-plugin-security. Expects the target project to
 * have a working ESLint config; we pass --resolve-plugins-relative-to
 * to allow consuming repos to ship their own config. If eslint isn't
 * installed, gracefully returns available=false.
 */
export async function runEslint(path: string, reviewerName = 'eslint'): Promise<EslintResult> {
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
