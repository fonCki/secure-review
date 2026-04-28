import { describe, expect, it, vi } from 'vitest';
import type { CompleteInput, CompleteOutput, ModelAdapter } from '../src/adapters/types.js';
import type { SecureReviewConfig } from '../src/config/schema.js';

let costs: number[] = [];
let completeCalls = 0;

vi.mock('../src/adapters/factory.js', () => ({
  getAdapter: vi.fn((): ModelAdapter => ({
    provider: 'openai',
    mode: 'api',
    model: 'mock',
    async complete(_input: CompleteInput): Promise<CompleteOutput> {
      completeCalls += 1;
      return {
        text: '{"findings":[]}',
        usage: { inputTokens: 1, outputTokens: 1, costUSD: costs.shift() ?? 0 },
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

function config(maxCost: number, maxIterations: number): SecureReviewConfig {
  return {
    writer: { provider: 'openai', model: 'mock', skill: 'writer.md' },
    reviewers: [{ name: 'a', provider: 'openai', model: 'mock', skill: 'a.md' }],
    sast: { enabled: false, tools: [], inject_into_reviewer_context: false },
    review: { parallel: true },
    fix: { mode: 'sequential_rotation', max_iterations: maxIterations, final_verification: 'all_reviewers' },
    gates: {
      block_on_new_critical: true,
      block_on_new_high: false,
      max_cost_usd: maxCost,
      max_wall_time_minutes: 15,
    },
    output: {
      report: './reports/report-{timestamp}.md',
      findings: './reports/findings-{timestamp}.json',
      diff: './reports/diff-{timestamp}.patch',
    },
  };
}

describe('runFixMode gate timing', () => {
  it('stops after the initial scan when the initial reviewer cost exceeds the cap', async () => {
    costs = [2];
    completeCalls = 0;

    const out = await runFixMode({
      root: '/repo',
      config: config(1, 1),
      configDir: '/repo',
      env: {},
    });

    expect(out.gateBlocked).toBe(true);
    expect(out.gateReasons.some((r) => r.includes('cost cap'))).toBe(true);
    expect(out.iterations).toHaveLength(0);
    expect(out.verification).toBeUndefined();
    expect(completeCalls).toBe(1);
  });

  it('marks the run blocked when final verification pushes cost over the cap', async () => {
    costs = [1, 1];
    completeCalls = 0;

    const out = await runFixMode({
      root: '/repo',
      config: config(1.5, 0),
      configDir: '/repo',
      env: {},
    });

    expect(out.gateBlocked).toBe(true);
    expect(out.gateReasons.some((r) => r.includes('cost cap'))).toBe(true);
    expect(out.verification).toHaveLength(1);
    expect(out.totalCostUSD).toBe(2);
    expect(completeCalls).toBe(2);
  });
});
