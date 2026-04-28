import { describe, expect, it, vi } from 'vitest';
import type { CompleteInput, CompleteOutput, ModelAdapter } from '../src/adapters/types.js';
import type { SecureReviewConfig } from '../src/config/schema.js';

const state = vi.hoisted(() => ({
  reviewerCalls: 0,
}));

vi.mock('../src/adapters/factory.js', () => ({
  getAdapter: vi.fn(({ model }: { model: string }): ModelAdapter => ({
    provider: 'openai',
    mode: 'api',
    model,
    async complete(_input: CompleteInput): Promise<CompleteOutput> {
      if (model === 'writer') {
        return {
          text: '{"changes":[]}',
          usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.01 },
          durationMs: 1,
        };
      }

      state.reviewerCalls += 1;
      if (state.reviewerCalls === 2) throw new Error('verifier unavailable');
      return {
        text: JSON.stringify({
          findings: [
            {
              severity: 'HIGH',
              file: 'app.ts',
              line_start: 1,
              line_end: 1,
              title: 'Initial issue',
              description: 'Something to fix.',
            },
          ],
        }),
        usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.01 },
        durationMs: 1,
      };
    },
  })),
}));

vi.mock('../src/config/load.js', () => ({
  loadSkill: vi.fn(async () => '# Skill'),
  resolveSkillPath: vi.fn((skill: string) => skill),
}));

vi.mock('../src/sast/index.js', () => ({
  runAllSast: vi.fn(async () => ({
    findings: [],
    semgrep: { ran: false, count: 0 },
    eslint: { ran: false, count: 0 },
    npmAudit: { ran: false, count: 0 },
  })),
}));

vi.mock('../src/util/files.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/util/files.js')>();
  return {
    ...actual,
    readSourceTree: vi.fn(async () => [
      { path: '/repo/app.ts', relPath: 'app.ts', content: 'export const x = 1;', lines: 1 },
    ]),
  };
});

const { runFixMode } = await import('../src/modes/fix.js');

function config(): SecureReviewConfig {
  return {
    writer: { provider: 'openai', model: 'writer', skill: 'writer.md' },
    reviewers: [{ name: 'reviewer-a', provider: 'openai', model: 'reviewer', skill: 'a.md' }],
    sast: { enabled: false, tools: [], inject_into_reviewer_context: false },
    review: { parallel: true },
    fix: { mode: 'sequential_rotation', max_iterations: 1, final_verification: 'none' },
    gates: {
      block_on_new_critical: true,
      block_on_new_high: false,
      max_cost_usd: 20,
      max_wall_time_minutes: 15,
    },
    output: {
      report: './reports/report-{timestamp}.md',
      findings: './reports/findings-{timestamp}.json',
      diff: './reports/diff-{timestamp}.patch',
    },
  };
}

describe('runFixMode reviewer health', () => {
  it('fails review health when the last verifier fails and final verification is disabled', async () => {
    state.reviewerCalls = 0;

    const out = await runFixMode({
      root: '/repo',
      config: config(),
      configDir: '/repo',
      env: {},
    });

    expect(out.iterations).toHaveLength(1);
    expect(out.iterations[0]?.reviewerRun.status).toBe('failed');
    expect(out.reviewStatus).toBe('failed');
    expect(out.failedReviewers).toEqual(['reviewer-a']);
    expect(out.finalFindings).toEqual([]);
  });
});
