import { describe, expect, it } from 'vitest';
import { evaluateGates } from '../src/gates/evaluate.js';
import type { Finding } from '../src/findings/schema.js';

function mkFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-00',
    severity: 'MEDIUM',
    file: 'a.ts',
    lineStart: 1,
    lineEnd: 1,
    title: 't',
    description: 'd',
    reportedBy: [],
    confidence: 0.5,
    ...overrides,
  };
}

describe('evaluateGates', () => {
  const defaults = {
    block_on_new_critical: true,
    block_on_new_high: false,
    max_cost_usd: 20,
    max_wall_time_minutes: 15,
  };

  it('allows proceed when no triggers', () => {
    const d = evaluateGates(
      { beforeFindings: [], afterFindings: [], cumulativeCostUSD: 5, elapsedMs: 1000, iteration: 1 },
      defaults,
    );
    expect(d.proceed).toBe(true);
  });

  it('blocks on cost cap exceeded', () => {
    const d = evaluateGates(
      { beforeFindings: [], afterFindings: [], cumulativeCostUSD: 25, elapsedMs: 0, iteration: 1 },
      defaults,
    );
    expect(d.proceed).toBe(false);
    expect(d.reasons.some((r) => r.includes('cost cap'))).toBe(true);
  });

  it('blocks when new critical introduced', () => {
    const before: Finding[] = [];
    const after: Finding[] = [
      mkFinding({ file: 'x.ts', cwe: 'CWE-78', severity: 'CRITICAL', lineStart: 100 }),
    ];
    const d = evaluateGates(
      { beforeFindings: before, afterFindings: after, cumulativeCostUSD: 0, elapsedMs: 0, iteration: 2 },
      defaults,
    );
    expect(d.proceed).toBe(false);
    expect(d.reasons.some((r) => r.includes('CRITICAL'))).toBe(true);
  });

  it('does NOT block on iteration 0 even with new criticals', () => {
    const d = evaluateGates(
      {
        beforeFindings: [],
        afterFindings: [mkFinding({ severity: 'CRITICAL' })],
        cumulativeCostUSD: 0,
        elapsedMs: 0,
        iteration: 0,
      },
      defaults,
    );
    expect(d.proceed).toBe(true);
  });

  it('blocks on wall-time cap', () => {
    const d = evaluateGates(
      { beforeFindings: [], afterFindings: [], cumulativeCostUSD: 0, elapsedMs: 20 * 60_000, iteration: 1 },
      defaults,
    );
    expect(d.proceed).toBe(false);
    expect(d.reasons.some((r) => r.includes('wall-time'))).toBe(true);
  });
});
