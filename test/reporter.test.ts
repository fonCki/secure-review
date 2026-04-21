import { describe, expect, it } from 'vitest';
import { renderReviewReport, renderFixReport } from '../src/reporters/markdown.js';
import { renderReviewEvidence, renderFixEvidence } from '../src/reporters/json.js';
import type { Finding } from '../src/findings/schema.js';

function mkFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-01',
    severity: 'HIGH',
    file: 'src/a.ts',
    lineStart: 10,
    lineEnd: 12,
    title: 'Missing authentication',
    description: 'The endpoint is unauthenticated.',
    remediation: 'Add auth middleware.',
    cwe: 'CWE-306',
    owaspCategory: 'A01:2025',
    reportedBy: ['codex', 'sonnet'],
    confidence: 0.9,
    ...overrides,
  };
}

describe('markdown renderers', () => {
  it('renders a review report', () => {
    const md = renderReviewReport({
      findings: [mkFinding()],
      breakdown: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0, INFO: 0 },
      sast: {
        findings: [],
        semgrep: { ran: true, count: 0 },
        eslint: { ran: true, count: 0 },
        npmAudit: { ran: true, count: 0 },
      },
      perReviewer: [
        {
          reviewer: 'codex',
          findings: [mkFinding()],
          rawText: '',
          usage: { inputTokens: 100, outputTokens: 200, costUSD: 0.01 },
          durationMs: 2000,
        },
      ],
      totalCostUSD: 0.01,
      totalDurationMs: 2000,
    });
    expect(md).toContain('Secure Review Report');
    expect(md).toContain('F-01');
    expect(md).toContain('CWE-306');
    expect(md).toContain('codex, sonnet');
  });

  it('renders a fix report with iteration rows', () => {
    const md = renderFixReport({
      initialFindings: [mkFinding()],
      finalFindings: [],
      initialBreakdown: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0, INFO: 0 },
      finalBreakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
      iterations: [
        {
          iteration: 1,
          reviewer: 'codex',
          reviewerRun: {
            reviewer: 'codex',
            findings: [mkFinding()],
            rawText: '',
            usage: { inputTokens: 100, outputTokens: 200, costUSD: 0.01 },
            durationMs: 1000,
          },
          sastBefore: { semgrep: 0, eslint: 0, npmAudit: 0 },
          sastAfter: { semgrep: 0, eslint: 0, npmAudit: 0 },
          findingsBefore: [mkFinding()],
          findingsAfter: [],
          newCritical: 0,
          resolved: 1,
          costUSD: 0.02,
        },
      ],
      gateBlocked: false,
      gateReasons: [],
      filesChanged: ['src/a.ts'],
      totalCostUSD: 0.02,
      totalDurationMs: 3000,
    });
    expect(md).toContain('Fix Mode Report');
    expect(md).toContain('All findings resolved');
    expect(md).toContain('src/a.ts');
  });
});

describe('json renderers', () => {
  it('emits Condition-D-compatible fields for a fix run', () => {
    const evidence = renderFixEvidence(
      {
        initialFindings: [mkFinding(), mkFinding({ id: 'F-02', cwe: 'CWE-79' })],
        finalFindings: [mkFinding({ id: 'F-02', cwe: 'CWE-79' })],
        initialBreakdown: { CRITICAL: 0, HIGH: 2, MEDIUM: 0, LOW: 0, INFO: 0 },
        finalBreakdown: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0, INFO: 0 },
        iterations: [],
        gateBlocked: false,
        gateReasons: [],
        filesChanged: [],
        totalCostUSD: 0.5,
        totalDurationMs: 5000,
      },
      { taskId: '01-auth', run: 1, modelVersion: 'm', reviewerNames: ['r1'] },
    );
    expect(evidence.total_findings_initial).toBe(2);
    expect(evidence.total_findings_after_fix).toBe(1);
    expect(evidence.findings_resolved).toBeGreaterThan(0);
    expect(evidence.resolution_rate_pct).toBeGreaterThan(0);
    expect(evidence.tool).toBe('secure-review');
  });

  it('emits review evidence', () => {
    const evidence = renderReviewEvidence(
      {
        findings: [mkFinding()],
        breakdown: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0, INFO: 0 },
        sast: {
          findings: [],
          semgrep: { ran: true, count: 0 },
          eslint: { ran: true, count: 0 },
          npmAudit: { ran: true, count: 0 },
        },
        perReviewer: [],
        totalCostUSD: 0,
        totalDurationMs: 0,
      },
      { taskId: 't', run: 1, modelVersion: 'm', reviewerNames: ['x'] },
    );
    expect(evidence.condition).toBe('F-review');
    expect(evidence.total_findings_initial).toBe(1);
  });
});
