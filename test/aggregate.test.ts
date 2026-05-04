import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregate, severityBreakdown } from '../src/findings/aggregate.js';
import { diffFindings } from '../src/findings/diff.js';
import type { Finding } from '../src/findings/schema.js';
import { normalizeFindingPaths } from '../src/util/files.js';

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

  it('Bug 1 (PR #3 audit): keeps findings separate when CWE differs at the same location', () => {
    // Pre-fix (v1-file-bucket): identity was {file, lineBucket} only, so
    // these two genuinely-distinct vulnerabilities silently merged with
    // mismatched title vs description. Post-fix (v2-file-bucket-cwe): CWE
    // is in the key → kept separate.
    const sqli = mkFinding({ cwe: 'CWE-89', title: 'SQL injection', reportedBy: ['model-a'] });
    const xss = mkFinding({ cwe: 'CWE-79', title: 'XSS', reportedBy: ['model-b'] });
    const out = aggregate([sqli, xss]);
    expect(out).toHaveLength(2);
  });

  it('two reviewers reporting the same finding (same CWE) at the same location merge with combined reportedBy', () => {
    // Cross-model agreement: both models flag the same CWE at the same
    // line — must merge so we get an "agreement" signal in confidence.
    const f1 = mkFinding({ cwe: 'CWE-306', reportedBy: ['model-a'] });
    const f2 = mkFinding({ cwe: 'CWE-306', reportedBy: ['model-b'] });
    const out = aggregate([f1, f2]);
    expect(out).toHaveLength(1);
    expect(out[0].reportedBy.sort()).toEqual(['model-a', 'model-b']);
  });

  it('re-numbers IDs sequentially', () => {
    const out = aggregate([
      mkFinding({ id: 'F-99', file: 'a' }),
      mkFinding({ id: 'F-17', file: 'b' }),
    ]);
    expect(out.map((f) => f.id)).toEqual(['F-01', 'F-02']);
  });

  it('merges findings after scan-root-relative path normalization', () => {
    const root = mkdtempSync(join(tmpdir(), 'sr-path-normalize-'));
    const out = aggregate(
      normalizeFindingPaths(
        [
          mkFinding({ file: join(root, 'src/a.ts'), cwe: 'CWE-306', reportedBy: ['eslint'] }),
          mkFinding({ file: './src/a.ts', cwe: 'CWE-306', reportedBy: ['ai'] }),
        ],
        root,
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0].file).toBe('src/a.ts');
    expect(out[0].reportedBy.sort()).toEqual(['ai', 'eslint']);
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
