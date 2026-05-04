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

  it('Bug 1 (PR #3 audit): includes CWE so two distinct vulns in the same bucket stay separate', () => {
    // Pre-fix (v1-file-bucket): {file, bucket} only → SQL injection at line
    // 7 and command injection at line 13 of the same file both fingerprinted
    // to `file::0` and the second was silently merged into the first.
    // Post-fix (v2-file-bucket-cwe): CWE is in the key → distinct.
    const sqlInj = mk({ cwe: 'CWE-89', title: 'SQL injection' });
    const cmdInj = mk({ cwe: 'CWE-78', title: 'Command injection' });
    expect(findingFingerprint(sqlInj)).not.toBe(findingFingerprint(cmdInj));
  });

  it('two reviewers reporting the SAME bug with the SAME CWE still match', () => {
    // Cross-model agreement: model A and model B both flag CWE-78 at the
    // same line — must merge so we get an "agreement" signal.
    const a = mk({ cwe: 'CWE-78', title: 'Command injection (model A wording)' });
    const b = mk({ cwe: 'CWE-78', title: 'OS command exec via shell (model B wording)' });
    expect(findingFingerprint(a)).toBe(findingFingerprint(b));
  });

  it('falls back to a 24-char title prefix when CWE is missing', () => {
    // Two findings with NO CWE but the same title prefix → match.
    const a = mk({ cwe: undefined, title: 'Missing authentication on /admin (a)' });
    const b = mk({ cwe: undefined, title: 'Missing authentication on /admin (b)' });
    expect(findingFingerprint(a)).toBe(findingFingerprint(b));
  });

  it('CWE-less findings with different titles in the same bucket stay separate', () => {
    const a = mk({ cwe: undefined, title: 'Missing authentication on /admin' });
    const b = mk({ cwe: undefined, title: 'Hardcoded credential in source' });
    expect(findingFingerprint(a)).not.toBe(findingFingerprint(b));
  });

  it('differs across files', () => {
    expect(findingFingerprint(mk({ file: 'src/a.ts' }))).not.toBe(findingFingerprint(mk({ file: 'src/b.ts' })));
  });
});

describe('aggregate and diff agree on identity', () => {
  it('two findings the aggregator merges (same CWE, same bucket) are also matched by diffFindings', () => {
    // Bug 1 fix: identity now requires same CWE OR same title-prefix to merge,
    // so this test uses the SAME CWE in before/after to exercise the merge path.
    const before = [mk({ lineStart: 25, cwe: 'CWE-306', reportedBy: ['model-a'] })];
    const after = [mk({ lineStart: 27, cwe: 'CWE-306', reportedBy: ['model-b'] })];

    // Aggregator: same file+bucket+CWE → merges into one.
    expect(aggregate([...before, ...after])).toHaveLength(1);

    // Diff: same fingerprint → counted as `remaining`, NOT resolved+introduced.
    const d = diffFindings(before, after);
    expect(d.remaining).toHaveLength(1);
    expect(d.resolved).toHaveLength(0);
    expect(d.introduced).toHaveLength(0);
  });

  it('Bug 1: two findings with DIFFERENT CWEs at the same line stay separate (no merge)', () => {
    // Pre-fix: silently merged with mismatched title vs description.
    // Post-fix: kept distinct so each is rendered correctly.
    const sqli = mk({ lineStart: 25, cwe: 'CWE-89', title: 'SQL injection', reportedBy: ['m'] });
    const xss = mk({ lineStart: 27, cwe: 'CWE-79', title: 'XSS', reportedBy: ['m'] });
    expect(aggregate([sqli, xss])).toHaveLength(2);
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
  it('returns the same stable ID for two reports of the same bug (same CWE)', () => {
    const r = new FindingRegistry();
    // Bug 1 fix: identity includes CWE, so reports must share the CWE
    // (or, when CWE is missing, share the 24-char title prefix) to be
    // matched as the "same" finding.
    const id1 = r.register(mk({ lineStart: 25, cwe: 'CWE-306', title: 'A' }));
    const id2 = r.register(mk({ lineStart: 28, cwe: 'CWE-306', title: 'B' })); // same file+bucket+CWE
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

  it('IDs survive across iterations: re-registering the "same bug" (same CWE) reuses the original ID', () => {
    const r = new FindingRegistry();
    // Bug 1 fix: identity requires same CWE for cross-iteration matching.
    // The verifier may re-word the title; the CWE is the stable signal.
    const iter1 = r.annotate([mk({ lineStart: 25, cwe: 'CWE-306' })]);
    const iter2 = r.annotate([mk({ lineStart: 27, cwe: 'CWE-306', title: 'rephrased' })]);
    expect(iter2[0]!.stableId).toBe(iter1[0]!.stableId);
  });
});
