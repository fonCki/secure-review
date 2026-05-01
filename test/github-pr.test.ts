import { describe, expect, it, vi } from 'vitest';
import type { Finding, SeverityBreakdown } from '../src/findings/schema.js';
import type { ReviewModeOutput } from '../src/modes/review.js';
import type { PrPostResult } from '../src/reporters/github-pr.js';

const mocks = vi.hoisted(() => ({
  createReview: vi.fn(),
}));

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn(() => ({
    pulls: {
      createReview: mocks.createReview,
    },
  })),
}));

const { evaluatePrGates, evaluateRuntimePrGate, postPrReview } = await import('../src/reporters/github-pr.js');

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-01',
    severity: 'HIGH',
    file: './src/a.ts',
    lineStart: 5,
    lineEnd: 5,
    title: 't',
    description: 'd',
    reportedBy: ['r'],
    confidence: 0.5,
    ...overrides,
  };
}

function output(findings: Finding[]): ReviewModeOutput {
  return {
    findings,
    breakdown: { CRITICAL: 0, HIGH: findings.length, MEDIUM: 0, LOW: 0, INFO: 0 },
    sast: {
      findings: [],
      semgrep: { ran: false, count: 0 },
      eslint: { ran: false, count: 0 },
      npmAudit: { ran: false, count: 0 },
    },
    perReviewer: [],
    reviewStatus: 'ok',
    failedReviewers: [],
    succeededReviewers: [],
    totalCostUSD: 0,
    totalDurationMs: 0,
  };
}

describe('postPrReview path normalization', () => {
  it('matches ./ finding paths to GitHub PR file paths', async () => {
    mocks.createReview.mockResolvedValueOnce({});

    const result = await postPrReview(output([finding()]), {
      owner: 'o',
      repo: 'r',
      prNumber: 1,
      commitSha: 'abc',
      token: 't',
      commentableLines: new Map([['src/a.ts', new Set([5])]]),
    });

    const params = mocks.createReview.mock.calls[0][0];
    expect(result.inlineCount).toBe(1);
    expect(params.comments[0].path).toBe('src/a.ts');
  });
});

const zeroBreakdown: SeverityBreakdown = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };

function prResult(overrides: Partial<PrPostResult>): PrPostResult {
  return {
    inlineCount: 0,
    summaryOnlyCount: 0,
    criticalOnDiff: 0,
    severityCountsInDiff: { ...zeroBreakdown },
    severityCountsTouched: { ...zeroBreakdown },
    droppedCount: 0,
    ...overrides,
  };
}

function gates(overrides = {}) {
  return {
    block_on_new_critical: false,
    block_on_new_high: false,
    max_cost_usd: 20,
    max_wall_time_minutes: 15,
    ...overrides,
  };
}

describe('evaluateRuntimePrGate', () => {
  it('blocks when dynamic gate fires on scanner-style findings', () => {
    const d = evaluateRuntimePrGate(
      [finding({ severity: 'HIGH', lineStart: 0, lineEnd: 0, file: 'https://demo.example/', id: 'N-001' })],
      { block_on_confirmed_critical: false, block_on_confirmed_high: true },
    );
    expect(d.blocked).toBe(true);
    expect(d.reasons[0]).toContain('HIGH');
  });

  it('allows clean aggregated runtime set', () => {
    expect(
      evaluateRuntimePrGate(
        [finding({ severity: 'MEDIUM', lineStart: 0, lineEnd: 0 })],
        { block_on_confirmed_critical: true, block_on_confirmed_high: false },
      ).blocked,
    ).toBe(false);
  });
});

describe('evaluatePrGates', () => {
  it('blocks high findings when block_on_new_high is enabled', () => {
    const decision = evaluatePrGates(
      prResult({
        inlineCount: 1,
        severityCountsInDiff: { ...zeroBreakdown, HIGH: 1 },
        severityCountsTouched: { ...zeroBreakdown, HIGH: 1 },
      }),
      0,
      gates({ block_on_new_high: true }),
    );

    expect(decision.blocked).toBe(true);
    expect(decision.reasons.join('; ')).toContain('HIGH');
  });

  it('blocks critical findings that are summary-only on touched files', () => {
    const decision = evaluatePrGates(
      prResult({
        summaryOnlyCount: 1,
        severityCountsTouched: { ...zeroBreakdown, CRITICAL: 1 },
      }),
      0,
      gates({ block_on_new_critical: true }),
    );

    expect(decision.blocked).toBe(true);
    expect(decision.reasons.join('; ')).toContain('CRITICAL');
  });

  it('blocks when total cost exceeds the configured cap', () => {
    const decision = evaluatePrGates(
      prResult({}),
      0.05,
      gates({ max_cost_usd: 0.01 }),
    );

    expect(decision.blocked).toBe(true);
    expect(decision.reasons.join('; ')).toContain('cost cap');
  });

  it('does not block when gates are off and no findings are present', () => {
    const decision = evaluatePrGates(prResult({}), 0, gates());

    expect(decision.blocked).toBe(false);
    expect(decision.reasons).toEqual([]);
  });
});
