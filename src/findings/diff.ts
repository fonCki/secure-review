import { findingFingerprint } from './identity.js';
import type { Finding } from './schema.js';

export interface FindingsDiff {
  resolved: Finding[];     // present before, absent after
  remaining: Finding[];    // present before AND after
  introduced: Finding[];   // absent before, present after (regressions!)
}

/**
 * Compare two Finding[] sets.
 *
 * Identity is the shared `findingFingerprint` (file + 10-line bucket) so the
 * diff and aggregator always agree on what counts as "the same finding".
 * Previously diff also keyed on CWE/title-prefix, which inflated the
 * "introduced" count whenever models reported the same bug with a different
 * label across iterations — see `findings/identity.ts` for the rationale.
 */
export function diffFindings(before: Finding[], after: Finding[]): FindingsDiff {
  const beforeKeys = new Map(before.map((f) => [findingFingerprint(f), f]));
  const afterKeys = new Map(after.map((f) => [findingFingerprint(f), f]));

  const resolved: Finding[] = [];
  const remaining: Finding[] = [];
  const introduced: Finding[] = [];

  for (const [k, f] of beforeKeys) {
    if (afterKeys.has(k)) remaining.push(afterKeys.get(k) as Finding);
    else resolved.push(f);
  }
  for (const [k, f] of afterKeys) {
    if (!beforeKeys.has(k)) introduced.push(f);
  }

  return { resolved, remaining, introduced };
}
