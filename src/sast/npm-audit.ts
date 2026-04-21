import { spawn } from 'node:child_process';
import type { Finding } from '../findings/schema.js';

export interface AuditResult {
  available: boolean;
  findings: Finding[];
  error?: string;
}

export async function runNpmAudit(path: string, reviewerName = 'npm-audit'): Promise<AuditResult> {
  const args = ['audit', '--json'];
  try {
    const { stdout, exitCode } = await run('npm', args, path);
    // npm audit exits non-zero when vulnerabilities found — fine.
    if (exitCode > 1) {
      return { available: false, findings: [] };
    }
    const parsed = JSON.parse(stdout) as {
      vulnerabilities?: Record<string, { severity?: string; via?: Array<string | { title?: string }>; name?: string }>;
    };
    const findings: Finding[] = [];
    let idx = 1;
    for (const [name, v] of Object.entries(parsed.vulnerabilities ?? {})) {
      const titles = (v.via ?? [])
        .map((entry) => (typeof entry === 'string' ? entry : (entry.title ?? '')))
        .filter(Boolean);
      findings.push({
        id: `NPM-${String(idx).padStart(2, '0')}`,
        severity: normalizeAuditSeverity(v.severity),
        file: 'package.json',
        lineStart: 0,
        lineEnd: 0,
        title: `Dependency: ${name}`,
        description: titles.join('; ') || `Vulnerable dependency ${name}`,
        reportedBy: [reviewerName],
        confidence: 0.9,
      });
      idx += 1;
    }
    return { available: true, findings };
  } catch (err) {
    return { available: false, findings: [], error: err instanceof Error ? err.message : String(err) };
  }
}

function normalizeAuditSeverity(s?: string): Finding['severity'] {
  switch ((s ?? 'low').toLowerCase()) {
    case 'critical':
      return 'CRITICAL';
    case 'high':
      return 'HIGH';
    case 'moderate':
    case 'medium':
      return 'MEDIUM';
    case 'low':
      return 'LOW';
    default:
      return 'INFO';
  }
}

function run(
  bin: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
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
