import { describe, expect, it } from 'vitest';
import { renderReviewHtml, renderFixHtml } from '../src/reporters/html.js';
import type { Finding } from '../src/findings/schema.js';

function mkFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-01',
    severity: 'HIGH',
    file: 'src/auth.ts',
    lineStart: 24,
    lineEnd: 26,
    title: 'Missing authentication on /admin',
    description: 'Endpoint is unauthenticated and exposes admin operations.',
    remediation: 'Add an auth middleware in front of the route.',
    cwe: 'CWE-306',
    owaspCategory: 'A01:2025',
    reportedBy: ['codex', 'sonnet'],
    confidence: 0.9,
    ...overrides,
  };
}

function mkReviewOutput(findings: Finding[]) {
  return {
    findings,
    breakdown: severityCount(findings),
    sast: {
      findings: [],
      semgrep: { ran: true, count: 0 },
      eslint: { ran: true, count: 0 },
      npmAudit: { ran: true, count: 0 },
    },
    perReviewer: [
      {
        reviewer: 'codex',
        status: 'ok' as const,
        findings,
        rawText: '',
        usage: { inputTokens: 100, outputTokens: 200, costUSD: 0.012 },
        durationMs: 2400,
      },
    ],
    reviewStatus: 'ok' as const,
    failedReviewers: [],
    succeededReviewers: ['codex'],
    totalCostUSD: 0.012,
    totalDurationMs: 2400,
    baselineSuppressed: [],
  };
}

function severityCount(findings: Finding[]): {
  CRITICAL: number;
  HIGH: number;
  MEDIUM: number;
  LOW: number;
  INFO: number;
} {
  const out = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  for (const f of findings) out[f.severity] += 1;
  return out;
}

describe('renderReviewHtml', () => {
  it('produces a self-contained document with embedded data + scripts', () => {
    const html = renderReviewHtml(mkReviewOutput([mkFinding()]));
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<title>Secure Review Report</title>');
    expect(html).toContain('id="sr-data"');
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
    expect(html).not.toMatch(/<link\s/);
    expect(html).not.toMatch(/<img\s/);
    expect(html).not.toMatch(/src=["']https?:/);
    expect(html).not.toMatch(/href=["']https?:/);
  });

  it('embeds findings in JSON for client-side filtering and excludes them from raw markup', () => {
    const html = renderReviewHtml(mkReviewOutput([mkFinding({ title: 'Distinct test marker' })]));
    const dataMatch = /<script id="sr-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    expect(dataMatch).not.toBeNull();
    const data = JSON.parse(dataMatch![1]!) as { findings: Finding[]; mode: string };
    expect(data.mode).toBe('review');
    expect(data.findings).toHaveLength(1);
    expect(data.findings[0]!.title).toBe('Distinct test marker');
    const renderedListMatch = /<div id="sr-findings">([\s\S]*?)<\/div>/.exec(html);
    expect(renderedListMatch).not.toBeNull();
    expect(renderedListMatch![1]!.includes('Distinct test marker')).toBe(false);
  });

  it('renders summary cards (cost, status, severity bars)', () => {
    const html = renderReviewHtml(mkReviewOutput([mkFinding(), mkFinding({ severity: 'CRITICAL' })]));
    expect(html).toContain('Findings');
    expect(html).toContain('$0.012');
    expect(html).toContain('Severity');
    expect(html).toMatch(/bar-critical[\s\S]*?>1</);
  });

  it('escapes HTML-special characters in findings (XSS-safe)', () => {
    const evil = mkFinding({
      title: '<script>alert(1)</script>',
      description: 'closing </script> here',
      file: 'src/<x>.ts',
      reportedBy: ['"><img src=x>'],
    });
    const html = renderReviewHtml(mkReviewOutput([evil]));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toMatch(/<img src=x>/);
    const dataMatch = /<script id="sr-data"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    expect(dataMatch).not.toBeNull();
    expect(dataMatch![1]!.includes('</script>')).toBe(false);
    expect(dataMatch![1]!).toContain('\\u003C/script>');
    const data = JSON.parse(dataMatch![1]!) as { findings: Finding[] };
    expect(data.findings[0]!.title).toBe('<script>alert(1)</script>');
  });

  it('shows baselineSuppressed count when present', () => {
    const out = mkReviewOutput([mkFinding()]);
    out.baselineSuppressed = [mkFinding({ id: 'F-99' })];
    const html = renderReviewHtml(out);
    expect(html).toMatch(/\+1 baselined/);
  });
});

describe('renderFixHtml', () => {
  it('renders the before/after block, iterations, and remaining findings', () => {
    const before = mkFinding({ id: 'F-A', stableId: 'S-001', file: 'src/a.ts', lineStart: 10 });
    const introduced = mkFinding({
      id: 'F-B',
      stableId: 'S-002',
      file: 'src/b.ts',
      lineStart: 100,
      severity: 'CRITICAL',
      title: 'Newly introduced regression',
    });
    const html = renderFixHtml({
      initialFindings: [before],
      finalFindings: [introduced],
      initialBreakdown: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0, INFO: 0 },
      finalBreakdown: { CRITICAL: 1, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
      iterations: [
        {
          iteration: 1,
          reviewer: 'codex',
          reviewerRun: {
            reviewer: 'codex',
            status: 'ok',
            findings: [introduced],
            rawText: '',
            usage: { inputTokens: 100, outputTokens: 200, costUSD: 0.05 },
            durationMs: 4000,
          },
          sastBefore: { semgrep: 0, eslint: 0, npmAudit: 0 },
          sastAfter: { semgrep: 0, eslint: 0, npmAudit: 0 },
          findingsBefore: [before],
          findingsAfter: [introduced],
          resolvedFindings: [before],
          introducedFindings: [introduced],
          newCritical: 1,
          resolved: 1,
          costUSD: 0.05,
        },
      ],
      gateBlocked: true,
      gateReasons: ['block_on_new_critical'],
      filesChanged: ['src/b.ts'],
      reviewStatus: 'ok',
      failedReviewers: [],
      succeededReviewers: ['codex'],
      totalCostUSD: 0.1,
      totalDurationMs: 5000,
      baselineSuppressed: [],
    });

    expect(html).toContain('<title>Secure Review — Fix Mode</title>');
    expect(html).toContain('Before vs after');
    expect(html).toContain('Iterations');
    expect(html).toContain('Iteration 1');
    expect(html).toContain('codex');
    expect(html).toContain('Resolved');
    expect(html).toContain('Introduced');
    expect(html).toContain('S-001');
    expect(html).toContain('S-002');
    expect(html).toContain('Files changed (1)');
    expect(html).toContain('BLOCKED');
    expect(html).toContain('block_on_new_critical');
    expect(html).toMatch(/Remaining findings/);
  });

  it('omits the per-iteration detail block for clean iterations', () => {
    const html = renderFixHtml({
      initialFindings: [],
      finalFindings: [],
      initialBreakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
      finalBreakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
      iterations: [
        {
          iteration: 1,
          reviewer: 'codex',
          reviewerRun: {
            reviewer: 'codex',
            status: 'ok',
            findings: [],
            rawText: '',
            usage: { inputTokens: 0, outputTokens: 0, costUSD: 0 },
            durationMs: 0,
          },
          sastBefore: { semgrep: 0, eslint: 0, npmAudit: 0 },
          sastAfter: { semgrep: 0, eslint: 0, npmAudit: 0 },
          findingsBefore: [],
          findingsAfter: [],
          resolvedFindings: [],
          introducedFindings: [],
          newCritical: 0,
          resolved: 0,
          costUSD: 0,
        },
      ],
      gateBlocked: false,
      gateReasons: [],
      filesChanged: [],
      reviewStatus: 'ok',
      failedReviewers: [],
      succeededReviewers: ['codex'],
      totalCostUSD: 0,
      totalDurationMs: 0,
      baselineSuppressed: [],
    });
    // No <details class="card iter-detail"> elements should be emitted for
    // a clean iteration. (The CSS rule for .iter-detail is always present.)
    expect(html).not.toMatch(/<details class="card iter-detail">/);
    expect(html).toContain('PASSED');
  });
});
