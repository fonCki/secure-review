import { z } from 'zod';
import { jsonrepair } from 'jsonrepair';
import { FindingSchema, type Finding, type Severity } from './schema.js';
import { log } from '../util/logger.js';

/**
 * Extract JSON from a model response. Models often wrap JSON in prose or
 * markdown fences; we tolerate both. As a final fallback we try
 * `jsonrepair` which can fix single-quoted strings, trailing commas,
 * truncated arrays, unescaped newlines in strings, and other common
 * model-generated JSON flaws.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // Strategy 1 — already JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const tried = tryParse(trimmed);
    if (tried !== undefined) return tried;
  }

  // Strategy 2 — fenced code block ```json ... ``` or ``` ... ```
  const fenceRe = /```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```/;
  const match = fenceRe.exec(trimmed);
  if (match?.[1]) {
    const tried = tryParse(match[1]);
    if (tried !== undefined) return tried;
  }

  // Strategy 3 — first {...} or [...] block (outer brace match)
  const objStart = trimmed.indexOf('{');
  const arrStart = trimmed.indexOf('[');
  const start =
    objStart >= 0 && (arrStart < 0 || objStart < arrStart) ? objStart : arrStart;
  if (start >= 0) {
    const open = trimmed[start];
    const close = open === '{' ? '}' : ']';
    const end = trimmed.lastIndexOf(close);
    if (end > start) {
      const tried = tryParse(trimmed.slice(start, end + 1));
      if (tried !== undefined) return tried;
    }
  }

  // Strategy 4 — jsonrepair, but only if we actually have brace/bracket
  // content to repair. Without structural brackets we'd be "repairing"
  // free text into a meaningless string literal.
  if (start >= 0) {
    try {
      const repaired = jsonrepair(trimmed.slice(start));
      const parsed = JSON.parse(repaired) as unknown;
      if (parsed !== null && (typeof parsed === 'object')) {
        return parsed;
      }
    } catch {
      // final fallthrough
    }
  }

  throw new Error(`No parseable JSON in model response (${trimmed.length} chars)`);
}

function tryParse(s: string): unknown | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/**
 * Permissive schema for parsing model output. Models sometimes emit
 * variations on severity ("Critical", "critical", "CRIT") — we normalize.
 */
const RawFindingSchema = z.object({
  id: z.string().optional(),
  severity: z.string().transform(normalizeSeverity),
  cwe: z.string().optional(),
  owasp: z.string().optional(),
  owasp_category: z.string().optional(),
  owaspCategory: z.string().optional(),
  file: z.string(),
  line: z.number().int().optional(),
  line_start: z.number().int().optional(),
  lineStart: z.number().int().optional(),
  line_end: z.number().int().optional(),
  lineEnd: z.number().int().optional(),
  title: z.string(),
  description: z.string(),
  remediation: z.string().optional(),
  fix: z.string().optional(),
});

const ReviewPayloadSchema = z
  .object({
    findings: z.array(z.unknown()),
  })
  .or(z.array(z.unknown()));

function normalizeSeverity(s: string): Severity {
  const up = s.trim().toUpperCase();
  if (up.startsWith('CRIT')) return 'CRITICAL';
  if (up.startsWith('HIGH')) return 'HIGH';
  if (up.startsWith('MED')) return 'MEDIUM';
  if (up.startsWith('LOW')) return 'LOW';
  if (up.startsWith('INFO') || up.startsWith('NOTE')) return 'INFO';
  return 'MEDIUM';
}

export function parseFindings(text: string, reviewerName: string): Finding[] {
  const json = extractJson(text);
  const parsed = ReviewPayloadSchema.parse(json);
  const raw = Array.isArray(parsed) ? parsed : parsed.findings;

  const findings: Finding[] = [];
  let skipped = 0;
  for (const [idx, item] of raw.entries()) {
    const rawResult = RawFindingSchema.safeParse(item);
    if (!rawResult.success) {
      skipped += 1;
      continue;
    }
    const r = rawResult.data;
    const lineStart = r.lineStart ?? r.line_start ?? r.line ?? 0;
    const lineEnd = r.lineEnd ?? r.line_end ?? lineStart;
    const findingResult = FindingSchema.safeParse({
      id: r.id ?? `F-${String(idx + 1).padStart(2, '0')}`,
      severity: r.severity,
      cwe: r.cwe,
      owaspCategory: r.owaspCategory ?? r.owasp_category ?? r.owasp,
      file: r.file,
      lineStart,
      lineEnd,
      title: r.title,
      description: r.description,
      remediation: r.remediation ?? r.fix,
      reportedBy: [reviewerName],
      confidence: 0.5,
    });
    if (!findingResult.success) {
      skipped += 1;
      continue;
    }
    findings.push(findingResult.data);
  }
  if (skipped > 0) {
    log.warn(`Reviewer ${reviewerName}: skipped ${skipped} malformed finding item(s)`);
  }
  return findings;
}
