import { spawn } from 'node:child_process';
import type { Finding } from '../findings/schema.js';

export interface SemgrepResult {
  available: boolean;
  findings: Finding[];
  raw?: unknown;
  error?: string;
}

/**
 * Invokes Semgrep with the same rulesets as the experiment's scan.sh
 * (secure-code-despite-ai/pipeline/scan.sh lines 29–56). Normalizes the
 * output into Finding[] so it can be aggregated alongside AI reviewer
 * findings.
 */
export async function runSemgrep(path: string, reviewerName = 'semgrep'): Promise<SemgrepResult> {
  const args = [
    '--config',
    'p/javascript',
    '--config',
    'p/typescript',
    '--config',
    'p/nodejs',
    '--config',
    'p/owasp-top-ten',
    '--json',
    '--quiet',
    '--no-git-ignore',
    '--error',
    path,
  ];

  try {
    const { stdout, stderr, exitCode } = await run('semgrep', args);
    // Semgrep exits 1 when findings are present — that's not an error for us.
    if (exitCode !== 0 && exitCode !== 1) {
      return { available: false, findings: [], error: stderr.trim() };
    }
    const parsed = JSON.parse(stdout) as {
      results?: Array<{
        check_id: string;
        path: string;
        start?: { line?: number };
        end?: { line?: number };
        extra?: { severity?: string; message?: string; metadata?: { cwe?: string | string[]; owasp?: string | string[] } };
      }>;
    };
    const findings: Finding[] = (parsed.results ?? []).map((r, i) => ({
      id: `SG-${String(i + 1).padStart(2, '0')}`,
      severity: normalizeSemgrepSeverity(r.extra?.severity),
      cwe: flatten(r.extra?.metadata?.cwe),
      owaspCategory: flatten(r.extra?.metadata?.owasp),
      file: r.path,
      lineStart: r.start?.line ?? 0,
      lineEnd: r.end?.line ?? r.start?.line ?? 0,
      title: r.check_id,
      description: r.extra?.message ?? r.check_id,
      reportedBy: [reviewerName],
      confidence: 0.75,
    }));
    return { available: true, findings, raw: parsed };
  } catch (err) {
    return { available: false, findings: [], error: err instanceof Error ? err.message : String(err) };
  }
}

function flatten(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function normalizeSemgrepSeverity(s?: string): Finding['severity'] {
  switch ((s ?? 'INFO').toUpperCase()) {
    case 'ERROR':
      return 'HIGH';
    case 'WARNING':
      return 'MEDIUM';
    case 'INFO':
      return 'LOW';
    default:
      return 'MEDIUM';
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
