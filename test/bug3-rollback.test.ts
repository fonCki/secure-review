import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshotFiles, augmentSnapshot, restoreSnapshot } from '../src/modes/fix.js';
import type { FileContent } from '../src/util/files.js';

/**
 * Bug 3 (PR #3 audit): in `--since` mode, the snapshot only covered
 * `beforeFiles` (the incremental subset). But `allowedFiles` could include
 * paths from findings outside that subset (LLM reviewers can mention
 * out-of-scope files). If the writer touched such a pre-existing file and
 * a later rollback fired, `restoreSnapshot` would mis-classify it as
 * "writer-created" and `rm` it — destroying real source code.
 *
 * Fix: a new `augmentSnapshot()` helper reads on-disk content for any
 * extra paths in `allowedFiles` not already in the snapshot, so rollback
 * has full coverage. Genuinely-new writer-created files (no on-disk
 * content) are still treated as deletable.
 */

describe('Bug 3 — augmentSnapshot prevents rollback from deleting pre-existing files', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sr-bug3-test-'));
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('snapshot covers beforeFiles + allowedFiles superset; rollback restores pre-existing files outside beforeFiles', async () => {
    // Layout: src/in_scope.ts (in beforeFiles) and out_of_scope.ts (not in
    // beforeFiles but in allowedFiles because a finding mentioned it).
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'src', 'in_scope.ts'), 'export const original_in = 1;\n');
    await writeFile(join(repo, 'out_of_scope.ts'), 'export const original_out = 2;\n');

    // Simulate the fix loop:
    // 1. beforeFiles is the incremental subset (only src/in_scope.ts)
    const beforeFiles: FileContent[] = [
      {
        path: join(repo, 'src', 'in_scope.ts'),
        relPath: 'src/in_scope.ts',
        content: 'export const original_in = 1;\n',
        lines: 1,
      },
    ];

    // 2. snapshotFiles covers beforeFiles only
    const snapshot = snapshotFiles(beforeFiles);
    expect(snapshot.has('src/in_scope.ts')).toBe(true);
    expect(snapshot.has('out_of_scope.ts')).toBe(false);

    // 3. augmentSnapshot is called with the allowedFiles superset
    //    (beforeFiles ∪ a finding pointing at out_of_scope.ts)
    const allowedFiles = new Set(['src/in_scope.ts', 'out_of_scope.ts']);
    await augmentSnapshot(snapshot, repo, allowedFiles);

    // After augment, snapshot covers BOTH files
    expect(snapshot.get('src/in_scope.ts')).toBe('export const original_in = 1;\n');
    expect(snapshot.get('out_of_scope.ts')).toBe('export const original_out = 2;\n');

    // 4. Simulate writer touching BOTH files (legitimately edits in_scope,
    //    legitimately edits out_of_scope because a finding pointed at it).
    await writeFile(join(repo, 'src', 'in_scope.ts'), 'export const writer_in = 999;\n');
    await writeFile(join(repo, 'out_of_scope.ts'), 'export const writer_out = 999;\n');

    // 5. Gate fires → rollback. Pre-fix: out_of_scope.ts would be DELETED
    //    because it's in writerTouchedRelPaths but not in the snapshot.
    //    Post-fix: snapshot has it, so it gets restored to original content.
    await restoreSnapshot(repo, snapshot, {
      writerTouchedRelPaths: ['src/in_scope.ts', 'out_of_scope.ts'],
    });

    // Both files should still exist with their ORIGINAL content
    expect(existsSync(join(repo, 'src', 'in_scope.ts'))).toBe(true);
    expect(existsSync(join(repo, 'out_of_scope.ts'))).toBe(true);
    expect(await readFile(join(repo, 'src', 'in_scope.ts'), 'utf8')).toBe('export const original_in = 1;\n');
    expect(await readFile(join(repo, 'out_of_scope.ts'), 'utf8')).toBe('export const original_out = 2;\n');
  });

  it('augmentSnapshot leaves snapshot entries that already exist untouched', async () => {
    await writeFile(join(repo, 'on_disk.ts'), 'on_disk content\n');
    const snapshot = new Map<string, string>();
    snapshot.set('on_disk.ts', 'snapshot content (older)');
    await augmentSnapshot(snapshot, repo, ['on_disk.ts']);
    // Existing entry is preserved; we don't re-read disk for paths
    // already in the snapshot.
    expect(snapshot.get('on_disk.ts')).toBe('snapshot content (older)');
  });

  it('augmentSnapshot silently skips paths that do not exist on disk (genuinely writer-created)', async () => {
    const snapshot = new Map<string, string>();
    await augmentSnapshot(snapshot, repo, ['does/not/exist.ts']);
    expect(snapshot.has('does/not/exist.ts')).toBe(false);
  });

  it('rollback STILL DELETES truly writer-created files (paths not in snapshot AND not on disk pre-writer)', async () => {
    // No pre-existing file, so augmentSnapshot can't add it.
    const snapshot = new Map<string, string>();
    await augmentSnapshot(snapshot, repo, ['new_file.ts']);

    // Writer creates the file.
    await writeFile(join(repo, 'new_file.ts'), 'writer-created\n');

    // Rollback should delete it (it's in writerTouchedRelPaths and not in snapshot).
    await restoreSnapshot(repo, snapshot, {
      writerTouchedRelPaths: ['new_file.ts'],
    });

    expect(existsSync(join(repo, 'new_file.ts'))).toBe(false);
  });
});
