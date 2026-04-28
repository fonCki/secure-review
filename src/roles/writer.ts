import type { ModelAdapter } from '../adapters/types.js';
import type { ModelRef } from '../config/schema.js';
import { extractJson } from '../findings/parse.js';
import type { Finding } from '../findings/schema.js';
import { isPathInside, serializeCodeContext, writeFileSafe, type FileContent } from '../util/files.js';
import { log } from '../util/logger.js';
import { lstat, realpath } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

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

/**
 * Writer models occasionally emit control characters (notably NUL / U+0000)
 * in regex character classes or escape sequences — e.g. `/\0.jpg$/` where they
 * meant `/\.jpg$/`. NUL bytes break downstream tooling hard: Node.js refuses
 * to spawn processes with NUL in argv (fails the next reviewer), many shells
 * truncate the string at NUL, and PR diffs silently drop NULs. Replace any
 * NUL with a visible placeholder so the file stays text-safe and any
 * resulting syntax error is easy for a human reviewer to spot.
 *
 * Other ASCII control characters (except tab \t, newline \n, carriage return
 * \r) are also stripped — they serve no purpose in source code and can
 * cause similar downstream issues with terminals and diffs.
 */
function sanitizeWriterContent(content: string, file: string): string {
  if (!content.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/)) return content;
  let nulls = 0;
  let others = 0;
  const cleaned = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, (ch) => {
    if (ch === '\x00') {
      nulls++;
      return '�'; // Unicode REPLACEMENT CHARACTER — highly visible
    }
    others++;
    return '';
  });
  log.warn(
    `Writer output for ${file} contained ${nulls} NUL byte(s)${
      others > 0 ? ` and ${others} other control character(s)` : ''
    } — sanitized before write.`,
  );
  return cleaned;
}

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

  // Try the model up to twice. The first attempt uses the normal prompt;
  // if the response isn't parseable JSON, retry once with a stricter
  // reminder appended. Empirically, Sonnet sometimes wraps its JSON in
  // prose ("Sure, here's the fix...") despite the OUTPUT_CONTRACT —
  // the second attempt with explicit "JSON ONLY, no prose" wording usually
  // succeeds. Cost: at most one extra LLM call per failed iteration.
  let totalUsage = { inputTokens: 0, outputTokens: 0, costUSD: 0 };
  let lastRawText = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const userForAttempt =
      attempt === 1
        ? user
        : `${user}\n\nPREVIOUS RESPONSE WAS NOT VALID JSON. You MUST return ONLY a JSON object starting with { and ending with }. NO prose. NO markdown fences. NO explanation. JUST the JSON.`;
    try {
      const response = await adapter.complete({
        system,
        user: userForAttempt,
        jsonMode: true,
        maxTokens: writer.maxTokens ?? 16_000,
      });
      lastRawText = response.text;
      totalUsage = {
        inputTokens: totalUsage.inputTokens + response.usage.inputTokens,
        outputTokens: totalUsage.outputTokens + response.usage.outputTokens,
        costUSD: totalUsage.costUSD + response.usage.costUSD,
      };
      const parsed = extractJson(response.text) as {
        changes?: Array<{ file: string; content: string }>;
      };
      const changes = parsed.changes ?? [];
      const filesChanged: string[] = [];
      for (const c of changes) {
        if (!c.file || typeof c.content !== 'string') continue;
        const target = await resolveWriterTarget(root, c.file);
        const sanitized = sanitizeWriterContent(c.content, c.file);
        await writeFileSafe(target, sanitized);
        filesChanged.push(c.file);
      }
      if (attempt === 2) {
        log.info(`Writer retry succeeded on attempt 2 (parsed JSON correctly).`);
      }
      return {
        filesChanged,
        rawText: response.text,
        usage: totalUsage,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isParseError = message.includes('No parseable JSON');
      if (attempt === 1 && isParseError) {
        log.warn(`Writer attempt 1 unparseable (${lastRawText.length} chars) — retrying with stricter prompt...`);
        continue;
      }
      log.warn(`Writer failed: ${message}`);
      return {
        filesChanged: [],
        rawText: lastRawText,
        usage: totalUsage,
        durationMs: Date.now() - started,
        error: message,
      };
    }
  }
  // Defensive fallthrough — TypeScript doesn't know the loop always returns.
  return {
    filesChanged: [],
    rawText: lastRawText,
    usage: totalUsage,
    durationMs: Date.now() - started,
    error: 'Writer exhausted retries',
  };
}

async function resolveWriterTarget(root: string, file: string): Promise<string> {
  const rootAbs = resolve(root);
  const rootReal = await realpath(rootAbs);
  const target = resolve(rootAbs, file);
  if (!isPathInside(rootAbs, target)) {
    throw new Error(`Writer refused to write outside scan root: ${file}`);
  }

  const rel = relative(rootAbs, target);
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  let current = rootAbs;
  for (const part of parts) {
    current = join(current, part);
    try {
      const st = await lstat(current);
      if (!st.isSymbolicLink()) continue;
      let real: string;
      try {
        real = await realpath(current);
      } catch {
        throw new Error(`Writer refused to write through broken symlink: ${relative(rootAbs, current)}`);
      }
      if (!isPathInside(rootReal, real)) {
        throw new Error(`Writer refused to write through symlink outside scan root: ${relative(rootAbs, current)}`);
      }
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') break;
      throw err;
    }
  }

  return target;
}
