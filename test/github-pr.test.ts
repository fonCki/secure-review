import { describe, expect, it, vi } from 'vitest';
import type { Finding } from '../src/findings/schema.js';
import type { ReviewModeOutput } from '../src/modes/review.js';

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

const { postPrReview } = await import('../src/reporters/github-pr.js');

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
