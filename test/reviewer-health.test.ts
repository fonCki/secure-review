import { describe, expect, it, vi } from 'vitest';
import type { CompleteInput, CompleteOutput, ModelAdapter } from '../src/adapters/types.js';
import type { SecureReviewConfig } from '../src/config/schema.js';
import { runReviewer } from '../src/roles/reviewer.js';
import type { FileContent } from '../src/util/files.js';

const adapterState = vi.hoisted(() => ({
  failingModels: new Set<string>(),
}));

vi.mock('../src/adapters/factory.js', () => ({
  getAdapter: vi.fn(({ model }: { model: string }): ModelAdapter => ({
    provider: 'openai',
    mode: 'api',
    model,
    async complete(_input: CompleteInput): Promise<CompleteOutput> {
      if (adapterState.failingModels.has(model)) throw new Error(`mock failure for ${model}`);
      return {
        text: '{"findings":[]}',
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
    readSourceTree: vi.fn(async () => [FILE]),
  };
});

const { runReviewMode } = await import('../src/modes/review.js');

const FILE: FileContent = {
  path: '/repo/app.ts',
  relPath: 'app.ts',
  content: 'export const x = 1;',
  lines: 1,
};

function config(models: string[]): SecureReviewConfig {
  return {
    writer: { provider: 'openai', model: 'writer', skill: 'writer.md' },
    reviewers: models.map((model) => ({
      name: model,
      provider: 'openai',
      model,
      skill: `${model}.md`,
    })),
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

describe('reviewer health', () => {
  it('marks a thrown reviewer call as failed', async () => {
    const adapter: ModelAdapter = {
      provider: 'openai',
      mode: 'api',
      model: 'mock',
      async complete() {
        throw new Error('provider unavailable');
      },
    };

    const out = await runReviewer({
      reviewer: { name: 'broken', provider: 'openai', model: 'mock', skill: 'broken.md' },
      adapter,
      skill: '# Skill',
      files: [FILE],
    });

    expect(out.status).toBe('failed');
    expect(out.error).toBe('provider unavailable');
    expect(out.findings).toEqual([]);
  });

  it('marks review mode degraded when one reviewer fails and one succeeds', async () => {
    adapterState.failingModels = new Set(['bad']);

    const out = await runReviewMode({
      root: '/repo',
      config: config(['bad', 'good']),
      configDir: '/repo',
      env: {},
    });

    expect(out.reviewStatus).toBe('degraded');
    expect(out.failedReviewers).toEqual(['bad']);
    expect(out.succeededReviewers).toEqual(['good']);
  });

  it('marks review mode failed when all reviewers fail', async () => {
    adapterState.failingModels = new Set(['bad-a', 'bad-b']);

    const out = await runReviewMode({
      root: '/repo',
      config: config(['bad-a', 'bad-b']),
      configDir: '/repo',
      env: {},
    });

    expect(out.reviewStatus).toBe('failed');
    expect(out.failedReviewers).toEqual(['bad-a', 'bad-b']);
    expect(out.succeededReviewers).toEqual([]);
  });
});
