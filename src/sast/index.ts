import type { SecureReviewConfig } from '../config/schema.js';
import type { Finding } from '../findings/schema.js';
import { runEslint } from './eslint.js';
import { runNpmAudit } from './npm-audit.js';
import { runSemgrep } from './semgrep.js';

export interface SastSummary {
  findings: Finding[];
  semgrep: { ran: boolean; count: number; error?: string };
  eslint: { ran: boolean; count: number; error?: string };
  npmAudit: { ran: boolean; count: number; error?: string };
}

export async function runAllSast(path: string, config: SecureReviewConfig['sast']): Promise<SastSummary> {
  const summary: SastSummary = {
    findings: [],
    semgrep: { ran: false, count: 0 },
    eslint: { ran: false, count: 0 },
    npmAudit: { ran: false, count: 0 },
  };
  if (!config.enabled) return summary;

  if (config.tools.includes('semgrep')) {
    const r = await runSemgrep(path);
    summary.semgrep = { ran: r.available, count: r.findings.length, error: r.error };
    summary.findings.push(...r.findings);
  }
  if (config.tools.includes('eslint')) {
    const r = await runEslint(path);
    summary.eslint = { ran: r.available, count: r.findings.length, error: r.error };
    summary.findings.push(...r.findings);
  }
  if (config.tools.includes('npm_audit')) {
    const r = await runNpmAudit(path);
    summary.npmAudit = { ran: r.available, count: r.findings.length, error: r.error };
    summary.findings.push(...r.findings);
  }
  return summary;
}
