import { describe, expect, it } from 'vitest';
import { aggregate, severityBreakdown } from '../src/findings/aggregate.js';
import { diffFindings } from '../src/findings/diff.js';
import type { Finding } from '../src/findings/schema.js';

function mkFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-00',
    severity: 'MEDIUM',
    file: 'src/a.ts',
    lineStart: 10,
    lineEnd: 12,
    title: 'thing',
    description: 'description',
    reportedBy: ['x'],
    confidence: 0.5,
    ...overrides,
  };
}

describe('aggregate', () => {
  it('merges findings at overlapping lines with same CWE', () => {
    const f1 = mkFinding({ file: 'src/a.ts', lineStart: 10, cwe: 'CWE-306', reportedBy: ['a'], severity: 'HIGH' });
    const f2 = mkFinding({ file: 'src/a.ts', lineStart: 12, cwe: 'CWE-306', reportedBy: ['b'], severity: 'CRITICAL' });
    const out = aggregate([f1, f2]);
    expect(out).toHaveLength(1);
    expect(out[0].reportedBy.sort()).toEqual(['a', 'b']);
    expect(out[0].severity).toBe('CRITICAL');
    expect(out[0].confidence).toBeCloseTo(2 / 3);
  });

  it('keeps findings separate when files differ', () => {
    const f1 = mkFinding({ file: 'src/a.ts', cwe: 'CWE-306' });
    const f2 = mkFinding({ file: 'src/b.ts', cwe: 'CWE-306' });
    expect(aggregate([f1, f2])).toHaveLength(2);
  });

  it('keeps findings separate when CWE differs', () => {
    const f1 = mkFinding({ cwe: 'CWE-306' });
    const f2 = mkFinding({ cwe: 'CWE-79' });
    expect(aggregate([f1, f2])).toHaveLength(2);
  });

  it('re-numbers IDs sequentially', () => {
    const out = aggregate([
      mkFinding({ id: 'F-99', file: 'a' }),
      mkFinding({ id: 'F-17', file: 'b' }),
    ]);
    expect(out.map((f) => f.id)).toEqual(['F-01', 'F-02']);
  });
});

describe('severityBreakdown', () => {
  it('counts correctly', () => {
    const b = severityBreakdown([
      mkFinding({ severity: 'CRITICAL' }),
      mkFinding({ severity: 'CRITICAL' }),
      mkFinding({ severity: 'HIGH' }),
      mkFinding({ severity: 'LOW' }),
    ]);
    expect(b).toEqual({ CRITICAL: 2, HIGH: 1, MEDIUM: 0, LOW: 1, INFO: 0 });
  });
});

describe('diffFindings', () => {
  it('detects resolved, remaining, introduced', () => {
    const before = [
      mkFinding({ file: 'a', cwe: 'CWE-1', lineStart: 10 }),
      mkFinding({ file: 'b', cwe: 'CWE-2', lineStart: 20 }),
    ];
    const after = [
      mkFinding({ file: 'b', cwe: 'CWE-2', lineStart: 22 }), // remaining (same bucket)
      mkFinding({ file: 'c', cwe: 'CWE-3', lineStart: 30 }), // new
    ];
    const diff = diffFindings(before, after);
    expect(diff.resolved).toHaveLength(1);
    expect(diff.resolved[0].file).toBe('a');
    expect(diff.remaining).toHaveLength(1);
    expect(diff.introduced).toHaveLength(1);
    expect(diff.introduced[0].file).toBe('c');
  });
});
