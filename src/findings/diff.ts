import type { Finding } from './schema.js';

export interface FindingsDiff {
  resolved: Finding[];     // present before, absent after
  remaining: Finding[];    // present before AND after
  introduced: Finding[];   // absent before, present after (regressions!)
}

/** Compare two Finding[] sets using the same bucket key as the aggregator. */
export function diffFindings(before: Finding[], after: Finding[]): FindingsDiff {
  const beforeKeys = new Map(before.map((f) => [bucket(f), f]));
  const afterKeys = new Map(after.map((f) => [bucket(f), f]));

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

function bucket(f: Finding): string {
  const b = Math.floor(f.lineStart / 10);
  const c = f.cwe ?? f.title.slice(0, 24).toLowerCase();
  return `${f.file}::${b}::${c}`;
}
