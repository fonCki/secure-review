import { describe, it, expect } from 'vitest';
import { filterSastByPaths, type SastSummary } from '../src/sast/index.js';
import type { Finding } from '../src/findings/schema.js';

/**
 * Bug 9 (PR #3 audit): SAST tools (semgrep / eslint / npm-audit) had no
 * `--since` awareness. They scan the full root and return findings for
 * every file regardless of `only`. The fix: post-filter the SastSummary
 * by membership in `only`.
 */

function mkFinding(file: string, reportedBy: string[], severity: Finding['severity'] = 'MEDIUM'): Finding {
  return {
    id: 'F-00',
    severity,
    file,
    lineStart: 1,
    lineEnd: 1,
    title: 't',
    description: 'd',
    reportedBy,
    confidence: 0.5,
  };
}

describe('filterSastByPaths — Bug 9', () => {
  it('drops everything when `only` is the empty set (incremental scope produced no files)', () => {
    // Codex round-2 audit (Bug 8 follow-up): an empty `only` set means the
    // caller's --since ref produced ZERO changed files. The pipeline must
    // be a no-op for that scope, NOT silently fall back to a full scan.
    // Pre-fix this returned the unfiltered summary (the wrong direction).
    const summary: SastSummary = {
      findings: [mkFinding('src/a.ts', ['semgrep'])],
      semgrep: { ran: true, count: 1 },
      eslint: { ran: false, count: 0 },
      npmAudit: { ran: false, count: 0 },
    };
    const result = filterSastByPaths(summary, new Set());
    expect(result.findings).toEqual([]);
    expect(result.semgrep.count).toBe(0);
    // Per-tool ran/error fields are preserved even when findings are dropped.
    expect(result.semgrep.ran).toBe(true);
  });

  it('drops findings whose file is not in the `only` set', () => {
    const summary: SastSummary = {
      findings: [
        mkFinding('src/a.ts', ['semgrep']),       // outside `only`
        mkFinding('src/b.ts', ['semgrep']),       // inside `only`
        mkFinding('docs/README.md', ['eslint']),  // outside `only`
      ],
      semgrep: { ran: true, count: 2 },
      eslint: { ran: true, count: 1 },
      npmAudit: { ran: false, count: 0 },
    };
    const result = filterSastByPaths(summary, new Set(['src/b.ts']));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.file).toBe('src/b.ts');
    // Per-tool counts must reflect the post-filter findings, not the
    // original full-tree counts.
    expect(result.semgrep.count).toBe(1);
    expect(result.eslint.count).toBe(0);
  });

  it('preserves the per-tool ran/error fields untouched', () => {
    const summary: SastSummary = {
      findings: [mkFinding('src/a.ts', ['semgrep'])],
      semgrep: { ran: true, count: 1, error: undefined },
      eslint: { ran: false, count: 0, error: 'eslint not installed' },
      npmAudit: { ran: true, count: 0 },
    };
    const result = filterSastByPaths(summary, new Set(['src/a.ts']));
    expect(result.eslint.ran).toBe(false);
    expect(result.eslint.error).toBe('eslint not installed');
    expect(result.semgrep.ran).toBe(true);
    expect(result.npmAudit.ran).toBe(true);
  });

  it('handles npm-audit findings (which use `npm-audit` or `npm_audit` in reportedBy)', () => {
    const summary: SastSummary = {
      findings: [
        mkFinding('package.json', ['npm-audit']),
        mkFinding('package.json', ['npm_audit']),
        mkFinding('src/a.ts', ['semgrep']),
      ],
      semgrep: { ran: true, count: 1 },
      eslint: { ran: false, count: 0 },
      npmAudit: { ran: true, count: 2 },
    };
    const result = filterSastByPaths(summary, new Set(['package.json']));
    expect(result.findings).toHaveLength(2);
    expect(result.npmAudit.count).toBe(2);
    expect(result.semgrep.count).toBe(0);
  });

  it('Bug A1 (round-2 blind audit): empty `only` set drops everything (the call sites in review.ts and fix.ts must route through this helper unconditionally when `only` is provided)', () => {
    // This test pins the contract that `filterSastByPaths(summary, new Set())`
    // returns drop-all, NOT the unfiltered summary. The bug fixed in commit
    // 25f3705 closed it for `readSourceTree` and this helper, but the
    // `runFilteredSast` wrapper in fix.ts and the inline check in review.ts
    // still had `if (only && only.size > 0)` short-circuits that bypassed
    // this helper for the empty-set case — letting full-tree SAST findings
    // through. Both call sites now use `if (only)` (not `.size > 0`) so
    // this test's contract IS the integration contract.
    const summary: SastSummary = {
      findings: [
        mkFinding('src/a.ts', ['semgrep'], 'CRITICAL'),
        mkFinding('src/b.ts', ['eslint'], 'HIGH'),
      ],
      semgrep: { ran: true, count: 1 },
      eslint: { ran: true, count: 1 },
      npmAudit: { ran: false, count: 0 },
    };
    const result = filterSastByPaths(summary, new Set());
    expect(result.findings).toHaveLength(0);
    expect(result.semgrep.count).toBe(0);
    expect(result.eslint.count).toBe(0);
  });

  it('drops everything if no findings match `only`', () => {
    const summary: SastSummary = {
      findings: [mkFinding('src/a.ts', ['semgrep'])],
      semgrep: { ran: true, count: 1 },
      eslint: { ran: false, count: 0 },
      npmAudit: { ran: false, count: 0 },
    };
    const result = filterSastByPaths(summary, new Set(['src/b.ts']));
    expect(result.findings).toHaveLength(0);
    expect(result.semgrep.count).toBe(0);
  });
});
