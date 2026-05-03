import { readdir, readFile, realpath, stat, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Finding } from '../findings/schema.js';

const execFileAsync = promisify(execFile);

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

// Lockfiles are auto-generated, often 100KB+, and contain no human-written
// code worth security-reviewing. Without skipping them, a typical Node
// project's package-lock.json (~100-300KB) eats the entire reviewer prompt
// budget (cf. serializeCodeContext maxChars=120_000) and crowds out the
// actual source files. Discovered in production: secure-review-tutorial-app
// PR #1 returned 0 LLM findings on visibly vulnerable code because
// package-lock.json (114K) consumed the prompt; src/server.js never made
// it to any reader.
const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'npm-shrinkwrap.json',
]);

/** Recursively read source files under a path, skipping common junk. */
export async function readSourceTree(
  root: string,
  maxBytesPerFile = 200_000,
  only?: Set<string>,
): Promise<FileContent[]> {
  const abs = resolve(root);
  const info = await stat(abs);
  if (info.isFile()) {
    const content = await readFile(abs, 'utf8');
    return [{ path: abs, relPath: basename(abs), content, lines: content.split('\n').length }];
  }
  // Empty `only` set is meaningful: the caller computed an incremental
  // scope (e.g. via --since) and it produced ZERO files — meaning the
  // pipeline should be a no-op for the current iteration. Returning the
  // full tree here would silently invert the user's intent. Per Codex
  // round-2 audit (Bug 8 follow-up).
  if (only) {
    if (only.size === 0) return [];
    const files: FileContent[] = [];
    await walk(abs, abs, files, maxBytesPerFile);
    return files.filter((f) => only.has(f.relPath));
  }
  const files: FileContent[] = [];
  await walk(abs, abs, files, maxBytesPerFile);
  return files;
}

/**
 * Return the set of paths changed since a git ref (branch, commit, tag),
 * each rebased to be relative to the SCAN ROOT (not the git root) so it
 * intersects correctly with `readSourceTree`'s `relPath` field.
 *
 * Bug 4 (PR #3 audit): the previous implementation returned paths from
 * `git diff --name-only` verbatim — those are git-root-relative. When the
 * caller passed a subdirectory as the scan root (e.g. `secure-review fix
 * ./src --since main`), the intersection with `readSourceTree('./src')`
 * was always empty because git returned `src/foo.ts` while `readSourceTree`
 * produced `relPath = foo.ts`. The `--since` filter then silently reviewed
 * zero files. We now:
 *
 *   1. Compute the git toplevel via `git rev-parse --show-toplevel`
 *   2. Resolve each git-returned path to absolute via the toplevel
 *   3. Drop any path that isn't inside the scan root
 *   4. Re-relativise the survivors to scan-root-relative form
 *
 * Untracked files are also included via `git ls-files --others
 * --exclude-standard` so a freshly-added file in the working tree is
 * still considered "changed since <ref>".
 *
 * Deleted files are excluded — we can't review them.
 */
export async function getGitChangedFiles(root: string, since: string): Promise<Set<string>> {
  // Use realpath to resolve symlinks (macOS /var → /private/var, etc.) so the
  // paths returned by git can be compared apples-to-apples with the scan root.
  // Without this, on macOS, `mktemp` returns /var/folders/... but git returns
  // /private/var/folders/... and `isPathInside` would silently say "outside".
  const rootAbsRaw = resolve(root);
  let rootAbs: string;
  try {
    rootAbs = await realpath(rootAbsRaw);
  } catch {
    rootAbs = rootAbsRaw; // fall back if realpath fails (e.g. ENOENT in tests)
  }

  let gitRootAbs: string;
  try {
    const { stdout: top } = await execFileAsync(
      'git',
      ['-C', rootAbs, 'rev-parse', '--show-toplevel'],
      { maxBuffer: 1 * 1024 * 1024 },
    );
    const trimmed = top.trim();
    if (!trimmed) throw new Error('empty git toplevel');
    try {
      gitRootAbs = await realpath(trimmed);
    } catch {
      gitRootAbs = trimmed;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git rev-parse --show-toplevel failed for ${rootAbs}: ${msg}`);
  }

  // Use NUL-delimited output (-z) instead of newline-split + trim. The naive
  // approach corrupts paths containing spaces (trim) and quoted-escaped
  // non-ASCII paths (git's default core.quotePath behavior). -z output is
  // raw bytes terminated by \0 with no quoting.
  let changed: string[];
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', rootAbs, 'diff', '-z', '--name-only', '--diff-filter=ACMR', since],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    changed = stdout.split('\0').filter(Boolean);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git diff --name-only ${since} failed: ${msg}`);
  }

  // Also include untracked-but-not-ignored files. `git diff` skips them, but
  // a brand-new file in the working tree is conceptually "changed since <ref>"
  // and should be reviewed. We respect .gitignore on purpose: dist/, build/,
  // node_modules/, etc. are not source files the user wrote and should not
  // appear in --since results.
  let untracked: string[] = [];
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', rootAbs, 'ls-files', '-z', '--others', '--exclude-standard'],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    untracked = stdout.split('\0').filter(Boolean);
  } catch (err) {
    // Untracked enumeration is best-effort; treat failure as "no untracked".
    // Log when the failure looks like a buffer overflow so users with huge
    // unignored trees know why their fresh files got skipped.
    const msg = err instanceof Error ? err.message : String(err);
    if (/maxBuffer/i.test(msg)) {
      // Avoid importing logger here (createInterface circular); stderr is fine.
      process.stderr.write(
        `[secure-review] warning: git ls-files --others output exceeded 10MB buffer; untracked files will not be included in --since results. Add globs to .gitignore to reduce noise.\n`,
      );
    }
  }

  const result = new Set<string>();
  for (const gitRel of [...changed, ...untracked]) {
    const abs = resolve(gitRootAbs, gitRel);
    if (!isPathInside(rootAbs, abs)) continue;
    const scanRel = relative(rootAbs, abs).replace(/\\/g, '/');
    if (scanRel) result.add(scanRel);
  }
  return result;
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
    if (LOCKFILE_NAMES.has(entry.name)) continue;
    const dot = entry.name.lastIndexOf('.');
    const ext = dot >= 0 ? entry.name.slice(dot) : '';
    if (!CODE_EXTENSIONS.has(ext) && entry.name !== 'package.json' && entry.name !== 'Dockerfile') continue;
    try {
      const s = await stat(full);
      if (s.size > maxBytes) continue;
      const content = await readFile(full, 'utf8');
      out.push({
        path: full,
        // Always forward-slash on the relPath so cross-platform set
        // intersection (e.g., the `--since` filter at readSourceTree above)
        // compares apples-to-apples on Windows. The repo's canonical
        // convention is forward-slash (see normalizeRelPath / normalizeScanPath).
        relPath: relative(root, full).replace(/\\/g, '/'),
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

export function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function normalizeScanPath(file: string, root: string): string {
  const rootAbs = resolve(root);
  const slashPath = file.trim().replace(/\\/g, '/');
  const abs = isAbsolute(slashPath) ? slashPath : resolve(rootAbs, slashPath);
  const rel = relative(rootAbs, abs) || basename(rootAbs);
  return rel.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function normalizeRelPath(file: string): string {
  return file.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

export function normalizeFindingPaths(findings: Finding[], root: string): Finding[] {
  return findings.map((f) => ({
    ...f,
    file: normalizeScanPath(f.file, root),
  }));
}
