import { z } from 'zod';
import { FindingSchema, type Finding, type Severity } from './schema.js';

/**
 * Extract JSON from a model response. Models often wrap JSON in prose or
 * markdown fences; we tolerate both.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // Already JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to fence detection
    }
  }

  // Fenced code block ```json ... ``` or ``` ... ```
  const fenceRe = /```(?:json|JSON)?\s*\n([\s\S]*?)\n```/;
  const match = fenceRe.exec(trimmed);
  if (match?.[1]) {
    try {
      return JSON.parse(match[1]);
    } catch {
      // fall through
    }
  }

  // First {...} block or [...] block in the text
  const objStart = trimmed.indexOf('{');
  const arrStart = trimmed.indexOf('[');
  const start =
    objStart >= 0 && (arrStart < 0 || objStart < arrStart) ? objStart : arrStart;
  if (start >= 0) {
    const open = trimmed[start];
    const close = open === '{' ? '}' : ']';
    const end = trimmed.lastIndexOf(close);
    if (end > start) {
      const candidate = trimmed.slice(start, end + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        // give up
      }
    }
  }
  throw new Error(`No parseable JSON in model response (${trimmed.length} chars)`);
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
    findings: z.array(RawFindingSchema),
  })
  .or(z.array(RawFindingSchema));

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

  return raw.map((r, idx): Finding => {
    const lineStart = r.lineStart ?? r.line_start ?? r.line ?? 0;
    const lineEnd = r.lineEnd ?? r.line_end ?? lineStart;
    const finding = FindingSchema.parse({
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
    return finding;
  });
}
