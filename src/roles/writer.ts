import type { ModelAdapter } from '../adapters/types.js';
import type { ModelRef } from '../config/schema.js';
import { extractJson } from '../findings/parse.js';
import type { Finding } from '../findings/schema.js';
import { serializeCodeContext, writeFileSafe, type FileContent } from '../util/files.js';
import { log } from '../util/logger.js';
import { join } from 'node:path';

export interface WriterRunInput {
  writer: ModelRef;
  adapter: ModelAdapter;
  skill: string;
  root: string;
  files: FileContent[];
  findings: Finding[];
}

export interface WriterRunOutput {
  filesChanged: string[];
  rawText: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUSD: number;
  };
  durationMs: number;
  error?: string;
}

const SYSTEM_PREAMBLE = `You are a senior software engineer applying security fixes to existing code. You MUST NOT introduce features; you fix only the issues listed. You return the COMPLETE updated content of each modified file. You preserve all existing functionality and style.`;

const OUTPUT_CONTRACT = `
OUTPUT CONTRACT (MANDATORY):
Return ONLY a JSON object of the shape:

{
  "changes": [
    {
      "file": "relative/path/to/file.ts",
      "content": "<FULL UPDATED FILE CONTENT>"
    }
  ]
}

Rules:
- Include the FULL content of each changed file. No diffs, no omissions.
- Only include files you actually modified.
- Do NOT invent new files unless the fix strictly requires one (e.g. a middleware).
- Do NOT add unrelated refactors.
- Do NOT wrap the JSON in prose or markdown fences.
`;

export async function runWriter(input: WriterRunInput): Promise<WriterRunOutput> {
  const { writer, adapter, skill, root, files, findings } = input;
  const started = Date.now();

  if (findings.length === 0) {
    return {
      filesChanged: [],
      rawText: '',
      usage: { inputTokens: 0, outputTokens: 0, costUSD: 0 },
      durationMs: Date.now() - started,
    };
  }

  const codeContext = serializeCodeContext(files);
  const findingsList = findings
    .map(
      (f, i) =>
        `${i + 1}. [${f.severity}] ${f.file}:${f.lineStart}-${f.lineEnd}  ${f.cwe ?? ''} ${f.title}\n   ${f.description}${f.remediation ? `\n   Remediation: ${f.remediation}` : ''}`,
    )
    .join('\n\n');

  const system = `${SYSTEM_PREAMBLE}\n\n${skill}\n\n${OUTPUT_CONTRACT}`;
  const user = `Fix the following security findings. Modify only what is necessary.
${codeContext}

FINDINGS TO FIX:
${findingsList}`;

  try {
    const response = await adapter.complete({
      system,
      user,
      jsonMode: true,
      maxTokens: writer.maxTokens ?? 16_000,
    });
    const parsed = extractJson(response.text) as {
      changes?: Array<{ file: string; content: string }>;
    };
    const changes = parsed.changes ?? [];
    const filesChanged: string[] = [];
    for (const c of changes) {
      if (!c.file || typeof c.content !== 'string') continue;
      const target = join(root, c.file);
      await writeFileSafe(target, c.content);
      filesChanged.push(c.file);
    }
    return {
      filesChanged,
      rawText: response.text,
      usage: response.usage,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Writer failed: ${message}`);
    return {
      filesChanged: [],
      rawText: '',
      usage: { inputTokens: 0, outputTokens: 0, costUSD: 0 },
      durationMs: Date.now() - started,
      error: message,
    };
  }
}
