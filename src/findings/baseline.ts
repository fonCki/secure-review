import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { findingFingerprint } from './identity.js';
import { Severity, SEVERITY_ORDER, type Finding } from './schema.js';
import { log } from '../util/logger.js';

/**
 * Default file name for a baseline. `secure-review review` and
 * `secure-review fix` will auto-load this if it exists in the scan root,
 * unless `--no-baseline` is passed.
 */
export const DEFAULT_BASELINE_FILENAME = '.secure-review-baseline.json';

/** Stored entry per accepted finding. */
export const BaselineEntrySchema = z.object({
  fingerprint: z.string(),
  /** Snapshot of human-readable fields when accepted, for documentation. */
  file: z.string().optional(),
  lineStart: z.number().int().optional(),
  title: z.string().optional(),
  cwe: z.string().optional(),
  /**
   * Severity at the time the finding was baselined. Used by `applyBaseline`
   * (Bug 2 fix, PR #3 audit) to refuse suppressing an INCOMING finding whose
   * severity is HIGHER than the baselined one — a stale LOW baseline must
   * not silently hide a later CRITICAL in the same bucket.
   *
   * Stored as the loose `Severity` enum string for JSON portability;
   * `applyBaseline` re-validates and falls back to `INFO` if the field is
   * absent (legacy baselines pre-Bug-2).
   */
  severity: Severity.optional(),
  /** Optional rationale: why this finding is accepted (TP-but-tolerated, FP, etc.). */
  reason: z.string().optional(),
  /** ISO-8601 timestamp of when this entry was added. */
  acceptedAt: z.string().optional(),
});
export type BaselineEntry = z.infer<typeof BaselineEntrySchema>;

export const BaselineSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  entries: z.array(BaselineEntrySchema).default([]),
});
export type Baseline = z.infer<typeof BaselineSchema>;

export interface BaselineFilterResult {
  /** Findings that did NOT match any baseline entry. */
  kept: Finding[];
  /** Findings that DID match — i.e. were suppressed. */
  suppressed: Finding[];
}

/**
 * Apply a baseline to a list of findings.
 *
 * Bug 2 (PR #3 audit): severity-aware suppression. Pre-fix the matcher was
 * a `Set<fingerprint>` — any incoming finding whose fingerprint matched a
 * baseline entry was silently suppressed regardless of severity. Live
 * smoke test reproduced 3 CRITICALs being hidden by a single stale LOW
 * baseline entry in the same bucket.
 *
 * Post-fix: refuse to suppress when the incoming finding's severity is
 * HIGHER than the baselined entry's severity. Such findings flow through
 * to the report (and a warning is logged so the user knows the baseline
 * didn't fully apply). Legacy baseline entries without a severity field
 * are treated as INFO (the most permissive — they only suppress equally-
 * weak incoming findings).
 *
 * Pure function; no I/O.
 */
export function applyBaseline(findings: Finding[], baseline: Baseline | undefined): BaselineFilterResult {
  if (!baseline || baseline.entries.length === 0) {
    return { kept: findings, suppressed: [] };
  }
  // Map fingerprint → highest baselined severity for that fingerprint.
  // Multiple entries with the same fingerprint can occur if the baseline
  // file was hand-edited; use the highest so legitimate CRITICAL acceptances
  // aren't silently downgraded by a duplicate INFO entry.
  const acceptedSeverity = new Map<string, Finding['severity']>();
  for (const e of baseline.entries) {
    const sev = (e.severity ?? 'INFO') as Finding['severity'];
    const prev = acceptedSeverity.get(e.fingerprint);
    if (prev === undefined || SEVERITY_ORDER[sev] > SEVERITY_ORDER[prev]) {
      acceptedSeverity.set(e.fingerprint, sev);
    }
  }
  const kept: Finding[] = [];
  const suppressed: Finding[] = [];
  let escalated = 0;
  for (const f of findings) {
    const baselineSev = acceptedSeverity.get(findingFingerprint(f));
    if (baselineSev === undefined) {
      kept.push(f);
      continue;
    }
    // Bug 2: refuse to suppress when incoming severity is HIGHER than baselined.
    if (SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[baselineSev]) {
      kept.push(f);
      escalated += 1;
      continue;
    }
    suppressed.push(f);
  }
  if (escalated > 0) {
    log.warn(
      `Baseline: ${escalated} finding${escalated === 1 ? '' : 's'} kept despite a baseline match — incoming severity is higher than the baselined severity (Bug 2 safety guard). Update the baseline if these are intentional acceptances.`,
    );
  }
  return { kept, suppressed };
}

/** Build a baseline document containing every supplied finding. */
export function baselineFromFindings(findings: Finding[], reason?: string): Baseline {
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const entries: BaselineEntry[] = [];
  for (const f of findings) {
    const fp = findingFingerprint(f);
    if (seen.has(fp)) continue;
    seen.add(fp);
    entries.push({
      fingerprint: fp,
      file: f.file,
      lineStart: f.lineStart,
      title: f.title,
      cwe: f.cwe,
      severity: f.severity,
      reason,
      acceptedAt: now,
    });
  }
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    entries,
  };
}

/**
 * Merge new findings into an existing baseline. Existing entries
 * (matched by fingerprint) keep their original `reason`/`acceptedAt`;
 * new fingerprints are appended.
 */
export function mergeBaseline(existing: Baseline, findings: Finding[], reason?: string): Baseline {
  const now = new Date().toISOString();
  const known = new Set(existing.entries.map((e) => e.fingerprint));
  const additions: BaselineEntry[] = [];
  for (const f of findings) {
    const fp = findingFingerprint(f);
    if (known.has(fp)) continue;
    known.add(fp);
    additions.push({
      fingerprint: fp,
      file: f.file,
      lineStart: f.lineStart,
      title: f.title,
      cwe: f.cwe,
      severity: f.severity,
      reason,
      acceptedAt: now,
    });
  }
  return {
    ...existing,
    updatedAt: now,
    entries: [...existing.entries, ...additions],
  };
}

/** Read and validate a baseline file. Returns `undefined` if the file does not exist. */
export async function loadBaseline(path: string): Promise<Baseline | undefined> {
  if (!existsSync(path)) return undefined;
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw);
  return BaselineSchema.parse(parsed);
}

/** Write a baseline file (creating parent dirs as needed). */
export async function saveBaseline(path: string, baseline: Baseline): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
}
