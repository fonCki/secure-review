import { describe, expect, it, vi } from 'vitest';
import type { CompleteInput, CompleteOutput, ModelAdapter } from '../src/adapters/types.js';
import type { SecureReviewConfig } from '../src/config/schema.js';

let active = 0;
let maxActive = 0;

vi.mock('../src/adapters/factory.js', () => ({
  getAdapter: vi.fn((): ModelAdapter => ({
    provider: 'openai',
    mode: 'api',
    model: 'mock',
    async complete(_input: CompleteInput): Promise<CompleteOutput> {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return {
        text: '{"findings":[]}',
        usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.01 },
        durationMs: 10,
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

const { runReviewMode } = await import('../src/modes/review.js');

function config(parallel: boolean): SecureReviewConfig {
  return {
    writer: { provider: 'openai', model: 'mock', skill: 'writer.md' },
    reviewers: [
      { name: 'a', provider: 'openai', model: 'mock', skill: 'a.md' },
      { name: 'b', provider: 'openai', model: 'mock', skill: 'b.md' },
    ],
    sast: { enabled: false, tools: [], inject_into_reviewer_context: false },
    review: { parallel },
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

describe('runReviewMode sequential reviewers', () => {
  it('does not start the next reviewer until the previous one finishes', async () => {
    active = 0;
    maxActive = 0;

    await runReviewMode({
      root: '/repo',
      config: config(false),
      configDir: '/repo',
      env: {},
    });

    expect(maxActive).toBe(1);
  });
});
