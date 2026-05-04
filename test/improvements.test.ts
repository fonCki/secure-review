/**
 * Tests for the 7 improvements:
 *   1. agreementCount helper + markdown badge
 *   2. (prompt text — verified by inspection)
 *   3. snapshotFiles / restoreSnapshot
 *   4. divergence detection in runFixMode
 *   5. benchmark mode output
 *   6. compare mode output
 *   7. filterFindingsForWriter confidence/severity thresholds + config schema defaults
 */

import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agreementCount } from '../src/findings/aggregate.js';
import { snapshotFiles, restoreSnapshot, filterFindingsForWriter } from '../src/modes/fix.js';
import { renderCompareReport } from '../src/modes/compare.js';
import { renderBenchmarkReport } from '../src/modes/benchmark.js';
import { renderReviewReport } from '../src/reporters/markdown.js';
import { SecureReviewConfigSchema } from '../src/config/schema.js';
import type { Finding } from '../src/findings/schema.js';
import type { CompleteInput, CompleteOutput, ModelAdapter } from '../src/adapters/types.js';
import type { SecureReviewConfig } from '../src/config/schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-01',
    severity: 'MEDIUM',
    file: 'src/a.ts',
    lineStart: 10,
    lineEnd: 12,
    title: 'thing',
    description: 'description',
    reportedBy: ['model-a'],
    confidence: 0.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Improvement 1: agreementCount + markdown badge
// ---------------------------------------------------------------------------

describe('agreementCount', () => {
  it('returns the length of reportedBy', () => {
    expect(agreementCount(mkFinding({ reportedBy: ['a', 'b', 'c'] }))).toBe(3);
  });

  it('returns 1 for a single reporter', () => {
    expect(agreementCount(mkFinding({ reportedBy: ['only-model'] }))).toBe(1);
  });

  it('returns 0 for an empty reportedBy', () => {
    expect(agreementCount(mkFinding({ reportedBy: [] }))).toBe(0);
  });
});

describe('markdown report — agreement badge', () => {
  it('shows "confirmed by N models" badge when multiple models agree', () => {
    const finding = mkFinding({ reportedBy: ['codex', 'sonnet', 'gemini'], confidence: 1 });
    const md = renderReviewReport({
      findings: [finding],
      breakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0, INFO: 0 },
      sast: {
        findings: [],
        semgrep: { ran: false, count: 0 },
        eslint: { ran: false, count: 0 },
        npmAudit: { ran: false, count: 0 },
      },
      perReviewer: [],
      reviewStatus: 'ok',
      failedReviewers: [],
      succeededReviewers: [],
      totalCostUSD: 0,
      totalDurationMs: 0,
    });
    expect(md).toContain('confirmed by 3 models');
  });

  it('does not show badge for a single reporter', () => {
    const finding = mkFinding({ reportedBy: ['only-model'], confidence: 0.5 });
    const md = renderReviewReport({
      findings: [finding],
      breakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0, INFO: 0 },
      sast: {
        findings: [],
        semgrep: { ran: false, count: 0 },
        eslint: { ran: false, count: 0 },
        npmAudit: { ran: false, count: 0 },
      },
      perReviewer: [],
      reviewStatus: 'ok',
      failedReviewers: [],
      succeededReviewers: [],
      totalCostUSD: 0,
      totalDurationMs: 0,
    });
    expect(md).not.toContain('confirmed by');
  });

  it('sorts findings by agreement count descending', () => {
    const highAgreement = mkFinding({ id: 'F-01', title: 'High Agreement', reportedBy: ['a', 'b', 'c'], confidence: 1 });
    const lowAgreement = mkFinding({ id: 'F-02', title: 'Low Agreement', reportedBy: ['a'], confidence: 0.3 });
    const md = renderReviewReport({
      findings: [lowAgreement, highAgreement], // intentionally out of order
      breakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 2, LOW: 0, INFO: 0 },
      sast: {
        findings: [],
        semgrep: { ran: false, count: 0 },
        eslint: { ran: false, count: 0 },
        npmAudit: { ran: false, count: 0 },
      },
      perReviewer: [],
      reviewStatus: 'ok',
      failedReviewers: [],
      succeededReviewers: [],
      totalCostUSD: 0,
      totalDurationMs: 0,
    });
    const posHigh = md.indexOf('High Agreement');
    const posLow = md.indexOf('Low Agreement');
    expect(posHigh).toBeLessThan(posLow); // High Agreement should appear first
  });
});

// ---------------------------------------------------------------------------
// Improvement 3: snapshotFiles / restoreSnapshot
// ---------------------------------------------------------------------------

describe('snapshotFiles / restoreSnapshot', () => {
  it('captures file contents in a map keyed by relPath', () => {
    const files = [
      { path: '/root/src/a.ts', relPath: 'src/a.ts', content: 'original-a', lines: 1 },
      { path: '/root/src/b.ts', relPath: 'src/b.ts', content: 'original-b', lines: 1 },
    ];
    const snap = snapshotFiles(files);
    expect(snap.size).toBe(2);
    expect(snap.get('src/a.ts')).toBe('original-a');
    expect(snap.get('src/b.ts')).toBe('original-b');
  });

  it('restores files to their original content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sr-snapshot-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/app.ts'), 'original content');

    const snap = new Map<string, string>();
    snap.set('src/app.ts', 'original content');

    // Overwrite the file
    writeFileSync(join(root, 'src/app.ts'), 'writer modified this');
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe('writer modified this');

    // Restore
    await restoreSnapshot(root, snap);
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe('original content');
  });

  it('does not delete tracked files that are missing from a subset snapshot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sr-snapshot-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/kept.ts'), 'must remain');
    writeFileSync(join(root, 'src/app.ts'), 'corrupt');

    const snap = new Map<string, string>();
    snap.set('src/app.ts', 'restored');

    await restoreSnapshot(root, snap);
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe('restored');
    expect(readFileSync(join(root, 'src/kept.ts'), 'utf8')).toBe('must remain');
  });

  it('removes new files introduced after the snapshot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sr-snapshot-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/app.ts'), 'original');

    const snap = new Map<string, string>();
    snap.set('src/app.ts', 'original');

    // Writer introduces a new code file
    writeFileSync(join(root, 'src/new.ts'), 'export const injected = 1;');
    expect(readFileSync(join(root, 'src/new.ts'), 'utf8')).toContain('injected');

    await restoreSnapshot(root, snap, { writerTouchedRelPaths: ['src/new.ts'] });
    expect(() => readFileSync(join(root, 'src/new.ts'), 'utf8')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Improvement 7: filterFindingsForWriter
// ---------------------------------------------------------------------------

describe('filterFindingsForWriter', () => {
  const findings = [
    mkFinding({ severity: 'CRITICAL', confidence: 0.9 }),
    mkFinding({ severity: 'HIGH', confidence: 0.6 }),
    mkFinding({ severity: 'MEDIUM', confidence: 0.4 }),
    mkFinding({ severity: 'LOW', confidence: 0.2 }),
    mkFinding({ severity: 'INFO', confidence: 0.1 }),
  ];

  it('passes all findings when min_confidence=0 and max_severity=INFO', () => {
    const result = filterFindingsForWriter(findings, 0, 'INFO');
    expect(result).toHaveLength(5);
  });

  it('filters out findings below the confidence threshold', () => {
    const result = filterFindingsForWriter(findings, 0.5, 'INFO');
    // CRITICAL (0.9) and HIGH (0.6) pass; MEDIUM (0.4), LOW (0.2), INFO (0.1) fail
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.severity)).toEqual(['CRITICAL', 'HIGH']);
  });

  it('filters out findings below the severity threshold', () => {
    // min_severity_to_fix='HIGH' means only CRITICAL and HIGH are sent
    const result = filterFindingsForWriter(findings, 0, 'HIGH');
    expect(result).toHaveLength(2);
    expect(result.every((f) => ['CRITICAL', 'HIGH'].includes(f.severity))).toBe(true);
  });

  it('combines confidence and severity filters', () => {
    // min_confidence=0.7, max_severity=HIGH — only CRITICAL (0.9) passes both
    const result = filterFindingsForWriter(findings, 0.7, 'HIGH');
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('CRITICAL');
  });

  it('returns empty array when no findings meet criteria', () => {
    const result = filterFindingsForWriter(findings, 0.99, 'CRITICAL');
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Improvement 7: Config schema defaults
// ---------------------------------------------------------------------------

describe('SecureReviewConfigSchema — fix config defaults', () => {
  it('defaults min_confidence_to_fix to 0', () => {
    const cfg = SecureReviewConfigSchema.parse({
      writer: { provider: 'anthropic', model: 'claude-sonnet-4-6', skill: 's' },
      reviewers: [{ name: 'a', provider: 'openai', model: 'gpt-5', skill: 'a' }],
    });
    expect(cfg.fix.min_confidence_to_fix).toBe(0);
  });

  it('defaults min_severity_to_fix to INFO', () => {
    const cfg = SecureReviewConfigSchema.parse({
      writer: { provider: 'anthropic', model: 'claude-sonnet-4-6', skill: 's' },
      reviewers: [{ name: 'a', provider: 'openai', model: 'gpt-5', skill: 'a' }],
    });
    expect(cfg.fix.min_severity_to_fix).toBe('INFO');
  });

  it('accepts custom min_confidence_to_fix and min_severity_to_fix', () => {
    const cfg = SecureReviewConfigSchema.parse({
      writer: { provider: 'anthropic', model: 'claude-sonnet-4-6', skill: 's' },
      reviewers: [{ name: 'a', provider: 'openai', model: 'gpt-5', skill: 'a' }],
      fix: {
        mode: 'sequential_rotation',
        max_iterations: 3,
        final_verification: 'all_reviewers',
        min_confidence_to_fix: 0.6,
        min_severity_to_fix: 'HIGH',
      },
    });
    expect(cfg.fix.min_confidence_to_fix).toBe(0.6);
    expect(cfg.fix.min_severity_to_fix).toBe('HIGH');
  });

  it('supports optional writers array for benchmarking', () => {
    const cfg = SecureReviewConfigSchema.parse({
      writer: { provider: 'anthropic', model: 'claude-sonnet-4-6', skill: 's' },
      writers: [
        { provider: 'anthropic', model: 'claude-sonnet-4-6', skill: 's' },
        { provider: 'openai', model: 'gpt-4o', skill: 's' },
      ],
      reviewers: [{ name: 'a', provider: 'openai', model: 'gpt-5', skill: 'a' }],
    });
    expect(cfg.writers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Improvement 5: renderBenchmarkReport
// ---------------------------------------------------------------------------

describe('renderBenchmarkReport', () => {
  it('renders a comparison table', () => {
    const md = renderBenchmarkReport({
      initialFindingsCount: 5,
      results: [
        {
          writerName: 'claude-sonnet-4-6',
          writerModel: 'claude-sonnet-4-6',
          filesChanged: 3,
          findingsResolved: 4,
          findingsIntroduced: 0,
          costUSD: 0.05,
          durationMs: 3000,
        },
        {
          writerName: 'gpt-4o',
          writerModel: 'gpt-4o',
          filesChanged: 2,
          findingsResolved: 2,
          findingsIntroduced: 1,
          costUSD: 0.03,
          durationMs: 2000,
        },
      ],
      totalDurationMs: 5000,
    });
    expect(md).toContain('Benchmark Report');
    expect(md).toContain('claude-sonnet-4-6');
    expect(md).toContain('gpt-4o');
    expect(md).toContain('Initial findings');
    // Table columns
    expect(md).toContain('Files Changed');
    expect(md).toContain('Resolved');
    expect(md).toContain('Introduced');
  });
});

// ---------------------------------------------------------------------------
// Improvement 6: renderCompareReport
// ---------------------------------------------------------------------------

describe('renderCompareReport', () => {
  const baseOutput = {
    findings: [] as Finding[],
    breakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
    sast: {
      findings: [],
      semgrep: { ran: false, count: 0 },
      eslint: { ran: false, count: 0 },
      npmAudit: { ran: false, count: 0 },
    },
    perReviewer: [],
    reviewStatus: 'ok' as const,
    failedReviewers: [],
    succeededReviewers: [],
    totalCostUSD: 0,
    totalDurationMs: 0,
  };

  it('renders a compare report with delta', () => {
    const findingA = mkFinding({ id: 'F-01', title: 'Only in A', cwe: 'CWE-999', lineStart: 10 });
    const findingB = mkFinding({ id: 'F-02', title: 'Only in B', cwe: 'CWE-100', lineStart: 50 });

    const md = renderCompareReport({
      pathA: '/repo/v1',
      pathB: '/repo/v2',
      outputA: { ...baseOutput, findings: [findingA], breakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0, INFO: 0 } },
      outputB: { ...baseOutput, findings: [findingB], breakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0, INFO: 0 } },
      uniqueToA: [findingA],
      uniqueToB: [findingB],
      common: [],
      delta: 'same',
      totalDurationMs: 1000,
    });

    expect(md).toContain('Compare Report');
    expect(md).toContain('/repo/v1');
    expect(md).toContain('/repo/v2');
    expect(md).toContain('same');
    expect(md).toContain('Unique to A');
    expect(md).toContain('Unique to B');
    expect(md).toContain('Common');
  });

  it('shows better/worse delta correctly', () => {
    const findingA = mkFinding({ id: 'F-01', title: 'Only in A', cwe: 'CWE-999', lineStart: 10 });

    const mdBetter = renderCompareReport({
      pathA: '/a',
      pathB: '/b',
      outputA: { ...baseOutput, findings: [findingA], breakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0, INFO: 0 } },
      outputB: { ...baseOutput, findings: [], breakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 } },
      uniqueToA: [findingA],
      uniqueToB: [],
      common: [],
      delta: 'better',
      totalDurationMs: 500,
    });
    expect(mdBetter).toContain('better');

    const mdWorse = renderCompareReport({
      pathA: '/a',
      pathB: '/b',
      outputA: { ...baseOutput, findings: [], breakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 } },
      outputB: { ...baseOutput, findings: [findingA], breakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0, INFO: 0 } },
      uniqueToA: [],
      uniqueToB: [findingA],
      common: [],
      delta: 'worse',
      totalDurationMs: 500,
    });
    expect(mdWorse).toContain('worse');
  });
});

// ---------------------------------------------------------------------------
// Improvement 4: divergence detection in runFixMode
// ---------------------------------------------------------------------------

let _findingSequence: Array<Finding[]> = [];

function makeConfig(maxIterations: number): SecureReviewConfig {
  return {
    writer: { provider: 'openai', model: 'mock', skill: 'w.md' },
    reviewers: [{ name: 'r', provider: 'openai', model: 'mock', skill: 'r.md' }],
    sast: { enabled: false, tools: [], inject_into_reviewer_context: false },
    review: { parallel: true },
    fix: {
      mode: 'sequential_rotation',
      max_iterations: maxIterations,
      final_verification: 'none',
      min_confidence_to_fix: 0,
      min_severity_to_fix: 'INFO',
    },
    gates: {
      block_on_new_critical: false,
      block_on_new_high: false,
      max_cost_usd: 100,
      max_wall_time_minutes: 15,
    },
    output: {
      report: './reports/report.md',
      findings: './reports/findings.json',
      diff: './reports/diff.patch',
    },
  };
}

describe('runFixMode divergence detection', () => {
  it('stops early when findings grow in 2 consecutive iterations', async () => {
    // These module mocks must be scoped to this test; vitest hoists `vi.mock`
    // to the top of the file, which would otherwise affect unrelated tests.
    vi.resetModules();
    vi.doMock('../src/adapters/factory.js', () => ({
      getAdapter: vi.fn((): ModelAdapter => ({
        provider: 'openai',
        mode: 'api',
        complete: vi.fn(async (_input: CompleteInput): Promise<CompleteOutput> => {
          const findings = _findingSequence.shift() ?? [];
          return {
            text: JSON.stringify({ findings }),
            usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.01 },
            durationMs: 1,
          };
        }),
      })),
    }));

    vi.doMock('../src/config/load.js', () => ({
      loadSkill: vi.fn(async () => '# Skill'),
      resolveSkillPath: vi.fn((s: string) => s),
    }));

    vi.doMock('../src/sast/index.js', () => ({
      runAllSast: vi.fn(async () => ({
        findings: [],
        semgrep: { ran: false, count: 0 },
        eslint: { ran: false, count: 0 },
        npmAudit: { ran: false, count: 0 },
      })),
    }));

    vi.doMock('../src/util/files.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/util/files.js')>();
      return {
        ...actual,
        readSourceTree: vi.fn(async () => [
          { path: '/repo/app.ts', relPath: 'app.ts', content: 'export const x = 1;', lines: 1 },
        ]),
      };
    });

    const { runFixMode } = await import('../src/modes/fix.js');

    // Initial scan → 1 finding; iter1 post-fix → 2 findings; iter2 post-fix → 3 findings
    // divergenceStreak hits 2 after iter2 — loop exits
    const baseFinding = mkFinding({ cwe: 'CWE-001', lineStart: 0 });
    const extraFinding1 = mkFinding({ file: 'src/b.ts', cwe: 'CWE-002', lineStart: 0 });
    const extraFinding2 = mkFinding({ file: 'src/c.ts', cwe: 'CWE-003', lineStart: 0 });

    _findingSequence = [
      // Initial scan reviewer response
      [baseFinding],
      // Writer response (iter 1): {"changes":[]} — ignored by reviewer mock
      // Verifier response iter 1: 2 findings (grew from 1 → 2)
      [baseFinding, extraFinding1],
      // Writer response iter 2 (2nd iteration writer call)
      // Verifier response iter 2: 3 findings (grew again 2 → 3, divergenceStreak = 2)
      [baseFinding, extraFinding1, extraFinding2],
    ];
    const out = await runFixMode({
      root: '/repo',
      config: makeConfig(5),
      configDir: '/repo',
      env: {},
    });

    // Should have stopped early due to divergence — at most 2 iterations
    expect(out.iterations.length).toBeLessThanOrEqual(2);
    // Should not be gate-blocked (divergence stops the loop but doesn't set gateBlocked)
    // The divergence breaks out of loop, final verification is 'none' so no extra calls
  });

  it('Bug 6: a divergent iteration that ALSO introduces a new CRITICAL must trigger the gate (rollback + gateBlocked) instead of silently breaking on divergence', async () => {
    // Pre-fix behavior: when both `divergenceStreak >= 2` AND a new CRITICAL
    // appear on the SAME iteration, the divergence-break exited the loop
    // BEFORE evaluateGates, so `block_on_new_critical` never fired and the
    // writer's bad changes were silently kept.
    //
    // Post-fix: divergence is recorded as a flag; the iteration is pushed
    // ONCE; gates evaluate (rolling back the writer's changes for new
    // CRITICALs); only then do we break on the divergence flag.
    //
    // The test scenario must:
    //   - have streak=2 IN THE SAME ITERATION as the new CRITICAL
    //   - so iter 1 must grow but NOT introduce CRITICAL (streak=1, no gate)
    //   - and iter 2 must grow AND introduce a new CRITICAL (streak=2 + gate)

    vi.resetModules();

    // Use a writer-distinct config so the adapter mock can demux by model.
    // Writer model = 'writer-model'; reviewer model = 'reviewer-model'.
    const writerCalls: string[] = [];
    const verifierCallSequence: Array<Finding[]> = [];

    vi.doMock('../src/adapters/factory.js', () => ({
      getAdapter: vi.fn((ref: { provider: string; model: string }): ModelAdapter => ({
        provider: ref.provider as ModelAdapter['provider'],
        mode: 'api',
        complete: vi.fn(async (_input: CompleteInput): Promise<CompleteOutput> => {
          if (ref.model === 'writer-model') {
            writerCalls.push(ref.model);
            return {
              // Valid writer payload — claims to change app.ts so the
              // rollback path has something to rm/restore on gate trigger.
              text: JSON.stringify({ changes: [{ file: 'app.ts', content: 'export const x = 2;' }] }),
              usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.01 },
              durationMs: 1,
            };
          }
          // Reviewer/verifier — drain the verifier sequence.
          const findings = verifierCallSequence.shift() ?? [];
          return {
            text: JSON.stringify({ findings }),
            usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.01 },
            durationMs: 1,
          };
        }),
      })),
    }));

    vi.doMock('../src/config/load.js', () => ({
      loadSkill: vi.fn(async () => '# Skill'),
      resolveSkillPath: vi.fn((s: string) => s),
    }));

    vi.doMock('../src/sast/index.js', () => ({
      runAllSast: vi.fn(async () => ({
        findings: [],
        semgrep: { ran: false, count: 0 },
        eslint: { ran: false, count: 0 },
        npmAudit: { ran: false, count: 0 },
      })),
    }));

    vi.doMock('../src/util/files.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/util/files.js')>();
      return {
        ...actual,
        readSourceTree: vi.fn(async () => [
          { path: '/repo/app.ts', relPath: 'app.ts', content: 'export const x = 1;', lines: 1 },
        ]),
        writeFileSafe: vi.fn(async () => {}),
      };
    });

    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return { ...actual, rm: vi.fn(async () => {}), writeFile: vi.fn(async () => {}) };
    });

    const { runFixMode } = await import('../src/modes/fix.js');

    // Sequence designed to corner Bug 6:
    //   initial: [LOW]                       — count = 1
    //   iter 1:  [LOW, LOW2]                 — grew 1→2, NO new CRITICAL → streak=1
    //   iter 2:  [LOW, LOW2, NEW_CRITICAL]   — grew 2→3, +1 CRITICAL    → streak=2
    //
    // Pre-fix: at iter 2, divergence-break runs FIRST (streak>=2), exits
    // loop without evaluating gates → gateBlocked stays false even though
    // a CRITICAL was introduced.
    //
    // Post-fix: at iter 2, gates evaluate FIRST (block_on_new_critical
    // fires), rollback happens, gateBlocked = true → divergence flag is
    // moot because we already broke via gate.
    const baseFinding = mkFinding({ severity: 'LOW', cwe: 'CWE-001', file: 'a.ts', lineStart: 0 });
    const baseLow2 = mkFinding({ severity: 'LOW', cwe: 'CWE-002', file: 'b.ts', lineStart: 0 });
    const newCrit = mkFinding({ severity: 'CRITICAL', cwe: 'CWE-100', file: 'c.ts', lineStart: 0 });

    verifierCallSequence.push(
      [baseFinding],                        // initial scan reviewer
      [baseFinding, baseLow2],              // iter 1 verifier — grew 1→2, no critical → streak=1
      [baseFinding, baseLow2, newCrit],     // iter 2 verifier — grew 2→3, +1 CRITICAL → streak=2 + new CRITICAL
    );

    const cfg = makeConfig(5);
    cfg.writer = { provider: 'openai', model: 'writer-model', skill: 'w.md' };
    cfg.reviewers = [{ name: 'r', provider: 'openai', model: 'reviewer-model', skill: 'r.md' }];
    cfg.gates = { ...cfg.gates, block_on_new_critical: true };

    const out = await runFixMode({
      root: '/repo',
      config: cfg,
      configDir: '/repo',
      env: {},
    });

    // Pre-fix bug: at iter 2, divergence-break exits BEFORE evaluateGates →
    // gateBlocked stays false even though a CRITICAL was introduced.
    // Post-fix: gates evaluate BEFORE divergence break → gate fires →
    // rollback → gateBlocked = true.
    expect(out.gateBlocked).toBe(true);
    expect(out.gateReasons.length).toBeGreaterThan(0);
    expect(out.gateReasons.join(' ')).toMatch(/CRITICAL/i);
    // Two iterations should have run before the gate fired in iter 2.
    expect(out.iterations.length).toBe(2);
    // Writer must have fired in both iterations (rollback at iter 2 acts on
    // the iter-2 writer's filesChanged set).
    expect(writerCalls.length).toBe(2);
  });
});
