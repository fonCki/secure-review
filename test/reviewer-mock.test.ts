import { describe, expect, it } from 'vitest';
import type { CompleteInput, CompleteOutput, ModelAdapter } from '../src/adapters/types.js';
import { runReviewer } from '../src/roles/reviewer.js';
import type { FileContent } from '../src/util/files.js';

/** Deterministic mock for integration tests — no API. */
class MockAdapter implements ModelAdapter {
  readonly provider = 'openai' as const;
  readonly model = 'mock';
  readonly mode = 'api' as const;
  constructor(private readonly response: string) {}
  async complete(_input: CompleteInput): Promise<CompleteOutput> {
    return {
      text: this.response,
      usage: { inputTokens: 100, outputTokens: 50, costUSD: 0.001 },
      durationMs: 10,
    };
  }
}

const VULN_FILE: FileContent = {
  path: '/tmp/auth.ts',
  relPath: 'auth.ts',
  content: `app.post('/charges', async (req, res) => {\n  // no auth!\n  await charge(req.body);\n  res.json({ ok: true });\n});\n`,
  lines: 5,
};

describe('runReviewer integration (with mock adapter)', () => {
  it('parses structured JSON response', async () => {
    const adapter = new MockAdapter(
      JSON.stringify({
        findings: [
          {
            severity: 'CRITICAL',
            cwe: 'CWE-306',
            owasp: 'A01:2025',
            file: 'auth.ts',
            line_start: 1,
            line_end: 4,
            title: 'Unauthenticated payment endpoint',
            description: 'POST /charges accepts charges without authentication.',
            remediation: 'Add authenticate() middleware.',
          },
        ],
      }),
    );
    const out = await runReviewer({
      reviewer: {
        name: 'mock-codex',
        provider: 'openai',
        model: 'mock',
        skill: '/tmp/skill',
      },
      adapter,
      skill: '# Skill',
      files: [VULN_FILE],
    });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].severity).toBe('CRITICAL');
    expect(out.findings[0].reportedBy).toEqual(['mock-codex']);
    expect(out.usage.costUSD).toBeGreaterThan(0);
  });

  it('captures errors without crashing', async () => {
    const adapter = new MockAdapter('this is not JSON at all just prose');
    const out = await runReviewer({
      reviewer: {
        name: 'mock-broken',
        provider: 'openai',
        model: 'mock',
        skill: '/tmp/skill',
      },
      adapter,
      skill: '',
      files: [VULN_FILE],
    });
    expect(out.error).toBeDefined();
    expect(out.findings).toEqual([]);
  });
});
