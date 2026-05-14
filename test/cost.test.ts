import { describe, expect, it } from 'vitest';
import { estimateCost, knownModel } from '../src/util/cost.js';

describe('estimateCost', () => {
  it('computes known model cost', () => {
    // claude-sonnet-4-6: $3/Mtok input, $15/Mtok output
    const cost = estimateCost('claude-sonnet-4-6', 1_000_000, 100_000);
    expect(cost).toBeCloseTo(3 + 1.5, 2);
  });

  it('uses fallback for unknown models', () => {
    expect(estimateCost('totally-new-model-x', 1_000_000, 100_000)).toBeGreaterThan(0);
    expect(knownModel('totally-new-model-x')).toBe(false);
  });

  it('scales linearly', () => {
    const a = estimateCost('gpt-4o-mini', 2_000_000, 1_000_000);
    const b = estimateCost('gpt-4o-mini', 1_000_000, 500_000);
    expect(a).toBeCloseTo(b * 2, 4);
  });

  it('knows gemini-2.5-flash pricing (papercut #2)', () => {
    // Was previously missing from PRICES table → cost estimator silently used
    // the fallback rate ($5/$15), inflating estimates by ~67×.
    expect(knownModel('gemini-2.5-flash')).toBe(true);
    // gemini-2.5-flash: $0.075/M input, $0.30/M output
    const cost = estimateCost('gemini-2.5-flash', 1_000_000, 100_000);
    expect(cost).toBeCloseTo(0.075 + 0.03, 4);
  });
});
