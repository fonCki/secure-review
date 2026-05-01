import { describe, expect, it } from 'vitest';
import { FindingSchema, EvidenceJsonSchema } from '../src/findings/schema.js';
import { SecureReviewConfigSchema, EnvSchema } from '../src/config/schema.js';

describe('FindingSchema', () => {
  it('accepts a complete finding', () => {
    const parsed = FindingSchema.parse({
      id: 'F-01',
      severity: 'HIGH',
      cwe: 'CWE-306',
      owaspCategory: 'A01:2025',
      file: 'src/auth.ts',
      lineStart: 42,
      lineEnd: 47,
      title: 'Missing authentication on /charges',
      description: 'Unauthenticated POST accepts arbitrary payment payloads.',
      remediation: 'Add authenticate() middleware.',
      reportedBy: ['codex'],
      confidence: 0.8,
    });
    expect(parsed.severity).toBe('HIGH');
    expect(parsed.reportedBy).toEqual(['codex']);
  });

  it('rejects invalid severity', () => {
    expect(() =>
      FindingSchema.parse({
        id: 'F-01',
        severity: 'SUPER_DUPER',
        file: 'a.ts',
        lineStart: 1,
        lineEnd: 1,
        title: 'x',
        description: 'y',
      }),
    ).toThrow();
  });

  it('defaults reportedBy and confidence', () => {
    const parsed = FindingSchema.parse({
      id: 'F-01',
      severity: 'LOW',
      file: 'a.ts',
      lineStart: 1,
      lineEnd: 1,
      title: 'x',
      description: 'y',
    });
    expect(parsed.reportedBy).toEqual([]);
    expect(parsed.confidence).toBe(0.5);
  });
});

describe('EvidenceJsonSchema', () => {
  it('parses a minimal condition-D-shape object', () => {
    const parsed = EvidenceJsonSchema.parse({
      task_id: '01-auth',
      tool: 'secure-review',
      condition: 'F-fix',
      run: 1,
      timestamp: new Date().toISOString(),
      model_version: 'claude-sonnet-4-6',
      total_findings_initial: 5,
      findings_by_severity_initial: { CRITICAL: 1, HIGH: 2, MEDIUM: 1, LOW: 1, INFO: 0 },
      total_findings_after_fix: 2,
      findings_by_severity_after_fix: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 1, INFO: 0 },
      new_findings_introduced: 0,
      findings_resolved: 3,
      resolution_rate_pct: 60,
      review_status: 'ok',
      failed_reviewers: [],
    });
    expect(parsed.task_id).toBe('01-auth');
    expect(parsed.findings_by_severity_after_fix.CRITICAL).toBe(0);
  });
});

describe('SecureReviewConfigSchema', () => {
  it('accepts a minimal valid config', () => {
    const parsed = SecureReviewConfigSchema.parse({
      writer: { provider: 'anthropic', model: 'claude-sonnet-4-6', skill: 'skills/w.md' },
      reviewers: [
        { name: 'a', provider: 'openai', model: 'gpt-5', skill: 'skills/a.md' },
      ],
    });
    expect(parsed.fix.max_iterations).toBe(3);
    expect(parsed.gates.max_cost_usd).toBe(20);
    expect(parsed.sast.enabled).toBe(true);
    expect(parsed.dynamic.enabled).toBe(false);
    expect(parsed.dynamic.checks).toContain('headers');
  });

  it('rejects empty reviewers', () => {
    expect(() =>
      SecureReviewConfigSchema.parse({
        writer: { provider: 'anthropic', model: 'x', skill: 's' },
        reviewers: [],
      }),
    ).toThrow();
  });

  it('accepts dynamic.auth_headers', () => {
    const parsed = SecureReviewConfigSchema.parse({
      writer: { provider: 'anthropic', model: 'x', skill: 's' },
      reviewers: [{ name: 'a', provider: 'openai', model: 'gpt-5', skill: 'skills/a.md' }],
      dynamic: {
        auth_headers: {
          Cookie: 'session=test',
          Authorization: 'Bearer token',
        },
      },
    });
    expect(parsed.dynamic.auth_headers?.Cookie).toBe('session=test');
  });
});

describe('EnvSchema', () => {
  it('defaults mode to api', () => {
    const parsed = EnvSchema.parse({});
    expect(parsed.ANTHROPIC_MODE).toBe('api');
    expect(parsed.OPENAI_MODE).toBe('api');
    expect(parsed.GOOGLE_MODE).toBe('api');
  });

  it('accepts cli mode', () => {
    const parsed = EnvSchema.parse({ ANTHROPIC_MODE: 'cli' });
    expect(parsed.ANTHROPIC_MODE).toBe('cli');
  });
});
