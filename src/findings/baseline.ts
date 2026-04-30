import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { findingFingerprint } from './identity.js';
import type { Finding } from './schema.js';

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
  severity: z.string().optional(),
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

/** Apply a baseline to a list of findings. Pure function; no I/O. */
export function applyBaseline(findings: Finding[], baseline: Baseline | undefined): BaselineFilterResult {
  if (!baseline || baseline.entries.length === 0) {
    return { kept: findings, suppressed: [] };
  }
  const accepted = new Set(baseline.entries.map((e) => e.fingerprint));
  const kept: Finding[] = [];
  const suppressed: Finding[] = [];
  for (const f of findings) {
    if (accepted.has(findingFingerprint(f))) suppressed.push(f);
    else kept.push(f);
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
