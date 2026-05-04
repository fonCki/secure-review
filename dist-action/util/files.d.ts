import type { Finding } from '../findings/schema.js';
export interface FileContent {
    /** Absolute path. */
    path: string;
    /** Path relative to the scan root. */
    relPath: string;
    content: string;
    lines: number;
}
/** Recursively read source files under a path, skipping common junk. */
export declare function readSourceTree(root: string, maxBytesPerFile?: number, only?: Set<string>): Promise<FileContent[]>;
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
export declare function getGitChangedFiles(root: string, since: string): Promise<Set<string>>;
export declare function serializeCodeContext(files: FileContent[], maxChars?: number): string;
export declare function writeFileSafe(path: string, content: string): Promise<void>;
export declare function isPathInside(parent: string, child: string): boolean;
export declare function normalizeScanPath(file: string, root: string): string;
export declare function normalizeRelPath(file: string): string;
export declare function normalizeFindingPaths(findings: Finding[], root: string): Finding[];
//# sourceMappingURL=files.d.ts.map