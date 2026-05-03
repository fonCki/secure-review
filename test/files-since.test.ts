import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { getGitChangedFiles } from '../src/util/files.js';

const execFileAsync = promisify(execFile);

/**
 * Bug 4 (PR #3 audit): `getGitChangedFiles` returned git-root-relative paths
 * but `readSourceTree`'s `relPath` is scan-root-relative — so the intersection
 * was empty whenever the scan root was a subdirectory of the git root, and
 * `--since` silently reviewed zero files.
 *
 * These tests build a real git repo in a tempdir and verify that
 * `getGitChangedFiles(scanRoot, since)` returns paths relative to `scanRoot`,
 * not the git root, AND that untracked files in the working tree are
 * included (so freshly-added files don't get silently skipped).
 */

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
  return stdout.trim();
}

describe('getGitChangedFiles — Bug 4 (PR #3 audit)', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sr-since-test-'));
    await git(repo, 'init', '-q');
    await git(repo, 'config', 'user.email', 't@t');
    await git(repo, 'config', 'user.name', 't');
    await git(repo, 'config', 'commit.gpgsign', 'false');
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('returns scan-root-relative paths when scanRoot === gitRoot', async () => {
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'init');

    await writeFile(join(repo, 'src', 'b.ts'), 'export const b = 2;\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'add b');

    const result = await getGitChangedFiles(repo, 'HEAD~1');
    expect([...result].sort()).toEqual(['src/b.ts']);
  });

  it('returns scan-root-relative paths when scanRoot is a subdir of gitRoot (the Bug 4 scenario)', async () => {
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'init');

    await writeFile(join(repo, 'src', 'newfile.ts'), 'export const n = 1;\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'add newfile');

    // Bug 4 repro: scanRoot = ./src, expected = "newfile.ts" (NOT "src/newfile.ts")
    const result = await getGitChangedFiles(join(repo, 'src'), 'HEAD~1');
    expect([...result].sort()).toEqual(['newfile.ts']);
  });

  it('drops files outside the scan root when scanRoot is a subdir', async () => {
    await mkdir(join(repo, 'src'), { recursive: true });
    await mkdir(join(repo, 'docs'), { recursive: true });
    await writeFile(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    await writeFile(join(repo, 'docs', 'README.md'), '# old\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'init');

    // Change one file inside scanRoot, one outside
    await writeFile(join(repo, 'src', 'b.ts'), 'export const b = 2;\n');
    await writeFile(join(repo, 'docs', 'README.md'), '# new\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'edit both');

    const result = await getGitChangedFiles(join(repo, 'src'), 'HEAD~1');
    // Only the src/-internal file should appear, and it should be src-relative
    expect([...result].sort()).toEqual(['b.ts']);
  });

  it('includes untracked files in the working tree (not just diffed)', async () => {
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'src', 'committed.ts'), 'export const a = 1;\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'init');

    // Create an untracked file — git diff won't see it, but we should
    await writeFile(join(repo, 'src', 'untracked.ts'), 'export const u = 1;\n');

    const result = await getGitChangedFiles(repo, 'HEAD');
    expect(result.has('src/untracked.ts')).toBe(true);
  });

  it('throws a useful error when given a non-existent ref', async () => {
    await writeFile(join(repo, 'a.ts'), '\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'init');

    await expect(getGitChangedFiles(repo, 'no-such-ref-xyz')).rejects.toThrow(/git diff --name-only no-such-ref-xyz failed/);
  });

  it('handles paths containing spaces (NUL-delimited git output, not newline+trim)', async () => {
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'init');

    // Add a file with a space in its name — newline+trim would mangle this
    await writeFile(join(repo, 'src', 'with space.ts'), 'export const x = 1;\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'add spaced file');

    const result = await getGitChangedFiles(repo, 'HEAD~1');
    expect([...result].sort()).toEqual(['src/with space.ts']);
  });

  it('handles paths containing non-ASCII characters (no quote-escaping corruption)', async () => {
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'init');

    // Non-ASCII filename — git's default core.quotePath would emit
    // backslash-escaped octal sequences in non-`-z` output. -z gives raw bytes.
    await writeFile(join(repo, 'src', 'café.ts'), 'export const c = 1;\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'add unicode file');

    const result = await getGitChangedFiles(repo, 'HEAD~1');
    expect([...result].sort()).toEqual(['src/café.ts']);
  });

  it('throws when given a non-git directory', async () => {
    const nonRepo = await mkdtemp(join(tmpdir(), 'sr-nonrepo-'));
    try {
      await expect(getGitChangedFiles(nonRepo, 'HEAD')).rejects.toThrow(/git rev-parse --show-toplevel failed/);
    } finally {
      await rm(nonRepo, { recursive: true, force: true });
    }
  });
});
