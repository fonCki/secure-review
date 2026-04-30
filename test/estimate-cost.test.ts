import { describe, expect, it } from 'vitest';
import { estimateRunCost, formatEstimateText } from '../src/util/estimate-cost.js';
import type { SecureReviewConfig } from '../src/config/schema.js';
import type { FileContent } from '../src/util/files.js';

function mkConfig(overrides: Partial<SecureReviewConfig> = {}): SecureReviewConfig {
  return {
    writer: { provider: 'anthropic', model: 'claude-sonnet-4-6', skill: 'skills/writer.md' },
    reviewers: [
      { name: 'codex', provider: 'openai', model: 'gpt-5-codex', skill: 'skills/r1.md' },
      { name: 'sonnet', provider: 'anthropic', model: 'claude-sonnet-4-6', skill: 'skills/r2.md' },
      { name: 'gemini', provider: 'google', model: 'gemini-2.5-pro', skill: 'skills/r3.md' },
    ],
    sast: { enabled: true, tools: ['semgrep', 'eslint', 'npm_audit'], inject_into_reviewer_context: true },
    review: { parallel: true },
    fix: {
      mode: 'sequential_rotation',
      max_iterations: 3,
      final_verification: 'all_reviewers',
      min_confidence_to_fix: 0,
      min_severity_to_fix: 'INFO',
    },
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
    ...overrides,
  };
}

function mkFiles(count: number, charsPerFile = 4000): FileContent[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `/tmp/src/file${i}.ts`,
    relPath: `src/file${i}.ts`,
    content: 'x'.repeat(charsPerFile),
    lines: 200,
  }));
}

describe('estimateRunCost — review mode', () => {
  it('schedules exactly one call per reviewer and zero writer calls', () => {
    const est = estimateRunCost({ config: mkConfig(), files: mkFiles(5), mode: 'review' });
    expect(est.perModel.filter((m) => m.role === 'writer')).toHaveLength(0);
    const reviewers = est.perModel.filter((m) => m.role === 'reviewer');
    expect(reviewers).toHaveLength(3);
    for (const r of reviewers) expect(r.calls).toBe(1);
  });

  it('produces a positive USD estimate for non-empty input', () => {
    const est = estimateRunCost({ config: mkConfig(), files: mkFiles(5), mode: 'review' });
    expect(est.totalCostUSD).toBeGreaterThan(0);
    expect(est.bandLowUSD).toBeLessThan(est.totalCostUSD);
    expect(est.bandHighUSD).toBeGreaterThan(est.totalCostUSD);
  });
});

describe('estimateRunCost — fix mode call counts', () => {
  it('sequential_rotation distributes verifier calls across reviewers in order', () => {
    const config = mkConfig({
      fix: {
        mode: 'sequential_rotation',
        max_iterations: 3,
        final_verification: 'all_reviewers',
        min_confidence_to_fix: 0,
        min_severity_to_fix: 'INFO',
      },
    });
    const est = estimateRunCost({ config, files: mkFiles(2), mode: 'fix' });
    const byName = new Map(
      est.perModel.filter((m) => m.role === 'reviewer').map((m) => [m.name, m.calls]),
    );
    // Each reviewer: 1 (initial) + 1 (verifier this iteration) + 1 (final all_reviewers) = 3
    expect(byName.get('codex')).toBe(3);
    expect(byName.get('sonnet')).toBe(3);
    expect(byName.get('gemini')).toBe(3);
  });

  it('parallel_aggregate puts all verifier iterations on the first reviewer', () => {
    const config = mkConfig({
      fix: {
        mode: 'parallel_aggregate',
        max_iterations: 4,
        final_verification: 'first_reviewer',
        min_confidence_to_fix: 0,
        min_severity_to_fix: 'INFO',
      },
    });
    const est = estimateRunCost({ config, files: mkFiles(1), mode: 'fix' });
    const byName = new Map(
      est.perModel.filter((m) => m.role === 'reviewer').map((m) => [m.name, m.calls]),
    );
    // codex: 1 (initial) + 4 (verifier) + 1 (final first_reviewer) = 6
    expect(byName.get('codex')).toBe(6);
    // sonnet & gemini: 1 (initial) + 0 + 0 = 1
    expect(byName.get('sonnet')).toBe(1);
    expect(byName.get('gemini')).toBe(1);
  });

  it('writer is called once per max_iterations', () => {
    const config = mkConfig({
      fix: {
        mode: 'sequential_rotation',
        max_iterations: 5,
        final_verification: 'none',
        min_confidence_to_fix: 0,
        min_severity_to_fix: 'INFO',
      },
    });
    const est = estimateRunCost({ config, files: mkFiles(1), mode: 'fix' });
    const writer = est.perModel.find((m) => m.role === 'writer')!;
    expect(writer.calls).toBe(5);
  });

  it('final_verification: none drops the post-loop reviewer pass', () => {
    const config = mkConfig({
      fix: {
        mode: 'sequential_rotation',
        max_iterations: 3,
        final_verification: 'none',
        min_confidence_to_fix: 0,
        min_severity_to_fix: 'INFO',
      },
    });
    const est = estimateRunCost({ config, files: mkFiles(1), mode: 'fix' });
    // Each reviewer: 1 initial + 1 verifier = 2
    for (const m of est.perModel.filter((m) => m.role === 'reviewer')) {
      expect(m.calls).toBe(2);
    }
  });
});

describe('estimateRunCost — pricing', () => {
  it('flags unknown models with the fallback rate', () => {
    const config = mkConfig({
      writer: { provider: 'anthropic', model: 'claude-future-9000', skill: 'x.md' },
    });
    const est = estimateRunCost({ config, files: mkFiles(1), mode: 'fix' });
    expect(est.unknownPricingModels).toContain('claude-future-9000');
  });
});

describe('formatEstimateText', () => {
  it('includes the USD range, per-model lines, and notes', () => {
    const est = estimateRunCost({ config: mkConfig(), files: mkFiles(2), mode: 'fix' });
    const text = formatEstimateText(est, 'fix', 20);
    expect(text).toContain('Pre-run cost estimate (fix)');
    expect(text).toContain('Range:');
    expect(text).toContain('Per model:');
    expect(text).toContain('codex');
    expect(text).toContain('Cap (gates.max_cost_usd): $20.00');
    expect(text).toContain('writer iteration');
  });

  it('omits the cap line when no cap is provided', () => {
    const est = estimateRunCost({ config: mkConfig(), files: mkFiles(1), mode: 'review' });
    const text = formatEstimateText(est, 'review');
    expect(text).not.toContain('gates.max_cost_usd');
  });
});
