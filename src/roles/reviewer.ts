import type { ModelAdapter } from '../adapters/types.js';
import type { ReviewerRef } from '../config/schema.js';
import { parseFindings } from '../findings/parse.js';
import type { Finding } from '../findings/schema.js';
import { serializeCodeContext, type FileContent } from '../util/files.js';
import { log } from '../util/logger.js';

export interface ReviewerRunInput {
  reviewer: ReviewerRef;
  adapter: ModelAdapter;
  skill: string;
  files: FileContent[];
  priorFindings?: Finding[];
}

export interface ReviewerRunOutput {
  reviewer: string;
  findings: Finding[];
  rawText: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUSD: number;
  };
  durationMs: number;
  error?: string;
}

const SYSTEM_PREAMBLE = `You are a security engineer performing a rigorous code review. You find real vulnerabilities in source code and report them as structured JSON. Do not speculate; only report issues you can point to in the code.`;

const OUTPUT_CONTRACT = `
OUTPUT CONTRACT (MANDATORY):
Return ONLY a JSON object of the shape:

{
  "findings": [
    {
      "id": "F-01",
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO",
      "cwe": "CWE-306",
      "owasp": "A01:2025",
      "file": "relative/path/to/file.ts",
      "line_start": 42,
      "line_end": 47,
      "title": "One-line summary",
      "description": "What the problem is. Why it is exploitable. Cite the code.",
      "remediation": "Concrete fix."
    }
  ]
}

Rules:
- Use severity CRITICAL for immediately exploitable issues (auth bypass, RCE, hardcoded secrets with impact).
- Use HIGH for issues that are exploitable with modest effort.
- Use MEDIUM for issues that weaken defense in depth.
- Use LOW for hygiene issues.
- Use INFO for notes.
- Every finding MUST include file, line_start, line_end, and a CWE or OWASP tag.
- Do NOT emit findings that are not backed by the code shown.
- Do NOT wrap the JSON in prose or markdown fences.
- If there are no findings, return {"findings": []}.
`;

export async function runReviewer(input: ReviewerRunInput): Promise<ReviewerRunOutput> {
  const { reviewer, adapter, skill, files, priorFindings } = input;
  const started = Date.now();

  const codeContext = serializeCodeContext(files);
  const priorSection =
    priorFindings && priorFindings.length > 0
      ? `\n\nPRIOR FINDINGS (from SAST tools or earlier reviewers — treat as hints, verify independently):\n${priorFindings
          .map(
            (f) =>
              `- [${f.severity}] ${f.file}:${f.lineStart} ${f.title} (reported by: ${f.reportedBy.join(', ')})`,
          )
          .join('\n')}`
      : '';

  const system = `${SYSTEM_PREAMBLE}\n\n${skill}\n\n${OUTPUT_CONTRACT}`;
  const user = `Review the following source code for security vulnerabilities.
Scan root: (relative paths shown per file)
${priorSection}

${codeContext}`;

  try {
    const response = await adapter.complete({ system, user, jsonMode: true, maxTokens: reviewer.maxTokens });
    const findings = parseFindings(response.text, reviewer.name);
    return {
      reviewer: reviewer.name,
      findings,
      rawText: response.text,
      usage: response.usage,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Reviewer ${reviewer.name} failed: ${message}`);
    return {
      reviewer: reviewer.name,
      findings: [],
      rawText: '',
      usage: { inputTokens: 0, outputTokens: 0, costUSD: 0 },
      durationMs: Date.now() - started,
      error: message,
    };
  }
}
