import type { SecureReviewConfig } from '../config/schema.js';
import type { Finding } from '../findings/schema.js';
import { diffFindings } from '../findings/diff.js';

export interface GateContext {
  beforeFindings: Finding[];
  afterFindings: Finding[];
  cumulativeCostUSD: number;
  elapsedMs: number;
  iteration: number;
}

export interface GateDecision {
  proceed: boolean;
  reasons: string[];
}

export function evaluateGates(ctx: GateContext, config: SecureReviewConfig['gates']): GateDecision {
  const reasons: string[] = [];

  if (config.max_cost_usd > 0 && ctx.cumulativeCostUSD > config.max_cost_usd) {
    reasons.push(
      `cost cap hit: $${ctx.cumulativeCostUSD.toFixed(2)} > $${config.max_cost_usd.toFixed(2)}`,
    );
  }

  const maxMs = config.max_wall_time_minutes * 60_000;
  if (maxMs > 0 && ctx.elapsedMs > maxMs) {
    reasons.push(`wall-time cap hit: ${(ctx.elapsedMs / 60_000).toFixed(1)} min`);
  }

  if (ctx.iteration > 0 && (config.block_on_new_critical || config.block_on_new_high)) {
    const diff = diffFindings(ctx.beforeFindings, ctx.afterFindings);
    if (config.block_on_new_critical) {
      const newCrit = diff.introduced.filter((f) => f.severity === 'CRITICAL');
      if (newCrit.length > 0) {
        reasons.push(
          `${newCrit.length} new CRITICAL finding(s) introduced in iteration ${ctx.iteration}`,
        );
      }
    }
    if (config.block_on_new_high) {
      const newHigh = diff.introduced.filter((f) => f.severity === 'HIGH');
      if (newHigh.length > 0) {
        reasons.push(
          `${newHigh.length} new HIGH finding(s) introduced in iteration ${ctx.iteration}`,
        );
      }
    }
  }

  return { proceed: reasons.length === 0, reasons };
}
