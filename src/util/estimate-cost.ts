import type { SecureReviewConfig } from '../config/schema.js';
import { estimateCost, knownModel } from './cost.js';
import { serializeCodeContext, type FileContent } from './files.js';

/**
 * Pre-run cost estimation.
 *
 * Implements item #4 from the post-experiment improvement list — show users
 * what a `review` or `fix` run is *likely* to cost before spending it. The
 * `secure-code-despite-ai` paper (§ Cost gates are not theoretical) measured
 * single-agent Condition C runs at $2–3 for one task on Sonnet pricing; with
 * multi-model rotation a `fix` run can easily reach $5–$50 depending on
 * codebase size, so a confirmation prompt is high-value protection.
 *
 * The numbers are deliberately upper-bound:
 *   - We assume every scheduled call actually fires (early-exit lowers actual cost).
 *   - Token budgets use the same `serializeCodeContext` cap reviewers/writers
 *     actually pay, so we never over-count above the prompt budget.
 *   - The ±30% band is wide enough to cover the gap between scheduled calls
 *     and observed completion-token sizes across providers.
 */

const TOKENS_PER_CHAR = 0.25;
const SKILL_PROMPT_TOKENS = 1500;
const REVIEWER_OUTPUT_TOKENS = 2500;
const WRITER_OUTPUT_TOKENS = 6000;
const SAST_INJECTED_TOKENS = 500;

export type EstimateMode = 'review' | 'fix';

export interface EstimateInput {
  config: SecureReviewConfig;
  files: FileContent[];
  mode: EstimateMode;
}

export interface ModelEstimate {
  role: 'reviewer' | 'writer';
  name: string;
  model: string;
  calls: number;
  inputTokensPerCall: number;
  outputTokensPerCall: number;
  totalCostUSD: number;
  knownPricing: boolean;
}

export interface CostEstimate {
  perModel: ModelEstimate[];
  totalCostUSD: number;
  /** Lower bound (currently 0.7×) — output volume often comes in under projection. */
  bandLowUSD: number;
  /** Upper bound (currently 1.3×) — covers verbose models and retried writer calls. */
  bandHighUSD: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  unknownPricingModels: string[];
  notes: string[];
  fileCount: number;
}

export function estimateRunCost(input: EstimateInput): CostEstimate {
  const { config, files, mode } = input;
  const codeChars = serializeCodeContext(files).length;
  const codeInputTokens = Math.round(codeChars * TOKENS_PER_CHAR);
  const sastTokens = config.sast.inject_into_reviewer_context ? SAST_INJECTED_TOKENS : 0;
  const reviewerInputTokens = codeInputTokens + SKILL_PROMPT_TOKENS + sastTokens;
  const writerInputTokens = codeInputTokens + SKILL_PROMPT_TOKENS;

  const reviewerCalls = computeReviewerCalls(config, mode);
  const perModel: ModelEstimate[] = [];

  for (const r of config.reviewers) {
    const calls = reviewerCalls.get(r.name) ?? 0;
    if (calls === 0) continue;
    perModel.push({
      role: 'reviewer',
      name: r.name,
      model: r.model,
      calls,
      inputTokensPerCall: reviewerInputTokens,
      outputTokensPerCall: REVIEWER_OUTPUT_TOKENS,
      totalCostUSD: calls * estimateCost(r.model, reviewerInputTokens, REVIEWER_OUTPUT_TOKENS),
      knownPricing: knownModel(r.model),
    });
  }

  if (mode === 'fix') {
    const calls = config.fix.max_iterations;
    perModel.push({
      role: 'writer',
      name: config.writer.name ?? 'writer',
      model: config.writer.model,
      calls,
      inputTokensPerCall: writerInputTokens,
      outputTokensPerCall: WRITER_OUTPUT_TOKENS,
      totalCostUSD: calls * estimateCost(config.writer.model, writerInputTokens, WRITER_OUTPUT_TOKENS),
      knownPricing: knownModel(config.writer.model),
    });
  }

  const totalCostUSD = perModel.reduce((s, m) => s + m.totalCostUSD, 0);
  const totalInputTokens = perModel.reduce((s, m) => s + m.calls * m.inputTokensPerCall, 0);
  const totalOutputTokens = perModel.reduce((s, m) => s + m.calls * m.outputTokensPerCall, 0);
  const unknownPricingModels = Array.from(
    new Set(perModel.filter((m) => !m.knownPricing).map((m) => m.model)),
  );

  return {
    perModel,
    totalCostUSD,
    bandLowUSD: totalCostUSD * 0.7,
    bandHighUSD: totalCostUSD * 1.3,
    totalInputTokens,
    totalOutputTokens,
    unknownPricingModels,
    notes: buildNotes(config, mode, files.length),
    fileCount: files.length,
  };
}

/**
 * Per-reviewer call count for the given mode. Mirrors the actual call sequence
 * in `runFixMode` so the estimate stays honest as the loop evolves:
 *   review:  1 call per reviewer (initial scan only).
 *   fix:     initial scan (N) + iteration verifier (max_iterations, rotated by mode)
 *            + final verification (N for all_reviewers, 1 for first_reviewer, 0 for none).
 */
function computeReviewerCalls(config: SecureReviewConfig, mode: EstimateMode): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of config.reviewers) counts.set(r.name, 0);

  if (mode === 'review') {
    for (const r of config.reviewers) counts.set(r.name, 1);
    return counts;
  }

  for (const r of config.reviewers) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);

  const iters = config.fix.max_iterations;
  if (config.fix.mode === 'parallel_aggregate') {
    const first = config.reviewers[0]?.name;
    if (first) counts.set(first, (counts.get(first) ?? 0) + iters);
  } else {
    for (let i = 0; i < iters; i += 1) {
      const r = config.reviewers[i % config.reviewers.length];
      if (r) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
    }
  }

  if (config.fix.final_verification === 'all_reviewers') {
    for (const r of config.reviewers) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  } else if (config.fix.final_verification === 'first_reviewer') {
    const first = config.reviewers[0]?.name;
    if (first) counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  return counts;
}

function buildNotes(config: SecureReviewConfig, mode: EstimateMode, fileCount: number): string[] {
  const notes = [
    `${fileCount} source file${fileCount === 1 ? '' : 's'} after filters (lockfiles + non-code excluded)`,
    'Upper bound — every scheduled call charged once; loop early-exit and short outputs typically come in under projection',
  ];
  if (mode === 'fix') {
    notes.push(
      `${config.fix.max_iterations} writer iteration${config.fix.max_iterations === 1 ? '' : 's'} max · rotation: ${config.fix.mode} · final verification: ${config.fix.final_verification}`,
    );
  }
  return notes;
}

export function formatEstimateText(
  est: CostEstimate,
  mode: EstimateMode,
  capUSD?: number,
): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`Pre-run cost estimate (${mode}):`);
  lines.push(
    `  Range:  $${est.bandLowUSD.toFixed(2)} – $${est.bandHighUSD.toFixed(2)}   (point: $${est.totalCostUSD.toFixed(2)})`,
  );
  lines.push(
    `  Tokens: ${formatTokens(est.totalInputTokens)} input · ${formatTokens(est.totalOutputTokens)} output`,
  );
  lines.push('');
  lines.push('  Per model:');
  const padName = Math.max(6, ...est.perModel.map((m) => m.name.length));
  const padModel = Math.max(6, ...est.perModel.map((m) => m.model.length));
  for (const m of est.perModel) {
    const unknownTag = m.knownPricing ? '' : '  (model price unknown — fallback rate used)';
    lines.push(
      `    ${m.role.padEnd(8)} ${m.name.padEnd(padName)} ${m.model.padEnd(padModel)} ${String(m.calls).padStart(2)} call${m.calls === 1 ? ' ' : 's'}  $${m.totalCostUSD.toFixed(2)}${unknownTag}`,
    );
  }
  if (capUSD !== undefined && capUSD > 0) {
    lines.push('');
    const exceeds = est.bandHighUSD > capUSD;
    const cmp = exceeds
      ? '— estimate may exceed cap; the loop will short-circuit if it does'
      : '— well within cap';
    lines.push(`  Cap (gates.max_cost_usd): $${capUSD.toFixed(2)}  ${cmp}`);
  }
  lines.push('');
  for (const n of est.notes) lines.push(`  · ${n}`);
  if (est.unknownPricingModels.length > 0) {
    lines.push(
      `  · Unknown pricing for: ${est.unknownPricingModels.join(', ')} — total may be off until prices land in src/util/cost.ts`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
