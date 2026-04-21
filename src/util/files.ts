import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

export interface FileContent {
  /** Absolute path. */
  path: string;
  /** Path relative to the scan root. */
  relPath: string;
  content: string;
  lines: number;
}

const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-action',
  'build',
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  'coverage',
  '.vitest-cache',
  'reports',
]);

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
]);

/** Recursively read source files under a path, skipping common junk. */
export async function readSourceTree(root: string, maxBytesPerFile = 200_000): Promise<FileContent[]> {
  const abs = resolve(root);
  const info = await stat(abs);
  if (info.isFile()) {
    const content = await readFile(abs, 'utf8');
    return [{ path: abs, relPath: basename(abs), content, lines: content.split('\n').length }];
  }
  const files: FileContent[] = [];
  await walk(abs, abs, files, maxBytesPerFile);
  return files;
}

async function walk(dir: string, root: string, out: FileContent[], maxBytes: number): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      await walk(full, root, out, maxBytes);
      continue;
    }
    if (!entry.isFile()) continue;
    const dot = entry.name.lastIndexOf('.');
    const ext = dot >= 0 ? entry.name.slice(dot) : '';
    if (!CODE_EXTENSIONS.has(ext) && entry.name !== 'package.json' && entry.name !== 'Dockerfile') continue;
    try {
      const s = await stat(full);
      if (s.size > maxBytes) continue;
      const content = await readFile(full, 'utf8');
      out.push({
        path: full,
        relPath: relative(root, full),
        content,
        lines: content.split('\n').length,
      });
    } catch {
      // unreadable — skip
    }
  }
}

export function serializeCodeContext(files: FileContent[], maxChars = 120_000): string {
  const parts: string[] = [];
  let total = 0;
  for (const f of files) {
    const header = `\n\n===== FILE: ${f.relPath} (${f.lines} lines) =====\n`;
    const numbered = numberLines(f.content);
    const chunk = header + numbered;
    if (total + chunk.length > maxChars) {
      parts.push(`\n\n[... additional files truncated (${files.length - parts.length} remaining) ...]`);
      break;
    }
    parts.push(chunk);
    total += chunk.length;
  }
  return parts.join('');
}

function numberLines(text: string): string {
  return text
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(4, ' ')}  ${line}`)
    .join('\n');
}

export async function writeFileSafe(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}
