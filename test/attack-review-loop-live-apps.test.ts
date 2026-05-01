import { describe, expect, it, vi } from 'vitest';
import type { CompleteInput, CompleteOutput, ModelAdapter } from '../src/adapters/types.js';
import type { SecureReviewConfig } from '../src/config/schema.js';

const state = vi.hoisted(() => ({
  reviewerCalls: 0,
  writerCalls: 0,
}));

vi.mock('../src/adapters/factory.js', () => ({
  getAdapter: vi.fn(({ model }: { model: string }): ModelAdapter => ({
    provider: 'openai',
    mode: 'api',
    model,
    async complete(_input: CompleteInput): Promise<CompleteOutput> {
      if (model === 'writer') {
        state.writerCalls += 1;
        return {
          text: JSON.stringify({
            changes: [
              {
                file: 'app.ts',
                rationale: 'Harden login and shell execution paths.',
                patch: [
                  "*** Begin Patch",
                  "*** Update File: app.ts",
                  "@@",
                  "-app.post('/login', (req, res) => {",
                  "+app.post('/login', authMiddleware, (req, res) => {",
                  "@@",
                  "-exec(req.query.cmd as string);",
                  "+// removed unsafe exec path",
                  "*** End Patch",
                ].join('\\n'),
              },
            ],
          }),
          usage: { inputTokens: 50, outputTokens: 60, costUSD: 0.02 },
          durationMs: 5,
        };
      }

      state.reviewerCalls += 1;
      const cleanAfterSecondVerifier = state.reviewerCalls >= 3;
      return {
        text: JSON.stringify({
          findings: cleanAfterSecondVerifier
            ? []
            : [
                {
                  severity: 'CRITICAL',
                  cwe: 'CWE-78',
                  file: 'app.ts',
                  line_start: 8,
                  line_end: 8,
                  title: 'Command injection through query param',
                  description: 'User-controlled command reaches exec().',
                  remediation: 'Delete exec() usage and use safe allowlist commands.',
                },
              ],
        }),
        usage: { inputTokens: 40, outputTokens: 40, costUSD: 0.01 },
        durationMs: 5,
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
      {
        path: '/repo/app.ts',
        relPath: 'app.ts',
        lines: 10,
        content: `import express from 'express';\nimport { exec } from 'node:child_process';\n\nconst app = express();\n\napp.post('/login', (req, res) => {\n  if (req.body.user === 'admin') res.json({ ok: true });\n});\n\nexec(req.query.cmd as string);\n`,
      },
    ]),
  };
});

const { runFixMode } = await import('../src/modes/fix.js');

function config(): SecureReviewConfig {
  return {
    writer: { provider: 'openai', model: 'writer', skill: 'writer.md' },
    reviewers: [
      { name: 'attacker-1', provider: 'openai', model: 'reviewer-a', skill: 'a.md' },
      { name: 'attacker-2', provider: 'openai', model: 'reviewer-b', skill: 'b.md' },
    ],
    sast: { enabled: false, tools: [], inject_into_reviewer_context: false },
    review: { parallel: true },
    fix: { mode: 'sequential_rotation', max_iterations: 4, final_verification: 'none' },
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

describe('attack review loop (live-app style fixtures)', () => {
  it('requires a full reviewer rotation of clean results before stopping', async () => {
    state.reviewerCalls = 0;
    state.writerCalls = 0;

    const out = await runFixMode({
      root: '/repo',
      config: config(),
      configDir: '/repo',
      env: {},
    });

    expect(out.finalFindings).toHaveLength(0);
    expect(out.iterations).toHaveLength(2);
    expect(out.iterations.map((i) => i.reviewer)).toEqual(['attacker-1', 'attacker-2']);
    expect(state.writerCalls).toBe(1);
  });
});
