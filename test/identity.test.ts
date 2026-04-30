import { describe, expect, it } from 'vitest';
import { findingFingerprint, FindingRegistry } from '../src/findings/identity.js';
import { aggregate } from '../src/findings/aggregate.js';
import { diffFindings } from '../src/findings/diff.js';
import type { Finding } from '../src/findings/schema.js';

function mk(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-00',
    severity: 'MEDIUM',
    file: 'src/auth.ts',
    lineStart: 25,
    lineEnd: 28,
    title: 'Missing authentication on /admin',
    description: 'Endpoint is not protected.',
    reportedBy: ['x'],
    confidence: 0.5,
    ...overrides,
  };
}

describe('findingFingerprint', () => {
  it('is stable across line shifts within the same 10-line bucket', () => {
    expect(findingFingerprint(mk({ lineStart: 20 }))).toBe(findingFingerprint(mk({ lineStart: 29 })));
  });

  it('differs when the line shifts to a new 10-line bucket', () => {
    expect(findingFingerprint(mk({ lineStart: 19 }))).not.toBe(findingFingerprint(mk({ lineStart: 30 })));
  });

  it('does not depend on CWE or title (the same bug labelled differently still matches)', () => {
    const a = mk({ cwe: 'CWE-78', title: 'Command injection' });
    const b = mk({ cwe: 'CWE-787', title: 'OS command exec via shell' });
    expect(findingFingerprint(a)).toBe(findingFingerprint(b));
  });

  it('differs across files', () => {
    expect(findingFingerprint(mk({ file: 'src/a.ts' }))).not.toBe(findingFingerprint(mk({ file: 'src/b.ts' })));
  });
});

describe('aggregate and diff agree on identity', () => {
  it('two findings the aggregator merges are also matched by diffFindings', () => {
    const before = [mk({ lineStart: 25, cwe: 'CWE-306', reportedBy: ['model-a'] })];
    const after = [mk({ lineStart: 27, cwe: 'CWE-79', reportedBy: ['model-b'] })];

    // Aggregator: same bucket → merges into one (different CWEs are tolerated).
    expect(aggregate([...before, ...after])).toHaveLength(1);

    // Diff: same bucket → counted as `remaining`, NOT resolved+introduced.
    // Before fix #6 this was a false-positive 'introduced' because diff keyed
    // on title-prefix as well as line-bucket.
    const d = diffFindings(before, after);
    expect(d.remaining).toHaveLength(1);
    expect(d.resolved).toHaveLength(0);
    expect(d.introduced).toHaveLength(0);
  });

  it('genuinely new findings are still reported as introduced', () => {
    const before = [mk({ file: 'src/a.ts', lineStart: 10 })];
    const after = [
      mk({ file: 'src/a.ts', lineStart: 10 }),
      mk({ file: 'src/a.ts', lineStart: 50, title: 'XSS in template' }),
    ];
    const d = diffFindings(before, after);
    expect(d.introduced).toHaveLength(1);
    expect(d.introduced[0]!.lineStart).toBe(50);
  });
});

describe('FindingRegistry', () => {
  it('returns the same stable ID for two reports of the same bug', () => {
    const r = new FindingRegistry();
    const id1 = r.register(mk({ lineStart: 25, title: 'A' }));
    const id2 = r.register(mk({ lineStart: 28, title: 'B' })); // same file+bucket, different title
    expect(id1).toBe(id2);
  });

  it('returns distinct stable IDs for distinct fingerprints', () => {
    const r = new FindingRegistry();
    const a = r.register(mk({ file: 'src/a.ts', lineStart: 10 }));
    const b = r.register(mk({ file: 'src/a.ts', lineStart: 100 }));
    const c = r.register(mk({ file: 'src/b.ts', lineStart: 10 }));
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('annotate() writes stableId onto the supplied findings', () => {
    const r = new FindingRegistry();
    const findings = [mk({ id: 'F-01' }), mk({ id: 'F-02', file: 'src/b.ts' })];
    const out = r.annotate(findings);
    expect(out).toBe(findings); // mutated in place
    expect(out[0]!.stableId).toBe('S-001');
    expect(out[1]!.stableId).toBe('S-002');
  });

  it('IDs survive across iterations: re-registering the "same bug" reuses the original ID', () => {
    const r = new FindingRegistry();
    const iter1 = r.annotate([mk({ lineStart: 25 })]);
    const iter2 = r.annotate([mk({ lineStart: 27, title: 'rephrased' })]);
    expect(iter2[0]!.stableId).toBe(iter1[0]!.stableId);
  });
});
