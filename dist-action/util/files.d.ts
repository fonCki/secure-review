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
 * Return the set of relative paths changed since a git ref (branch, commit, tag).
 * Uses `git diff --name-only <since>` — only files present in the working tree
 * are returned (deleted files are excluded since we can't review them).
 */
export declare function getGitChangedFiles(root: string, since: string): Promise<Set<string>>;
export declare function serializeCodeContext(files: FileContent[], maxChars?: number): string;
export declare function writeFileSafe(path: string, content: string): Promise<void>;
export declare function isPathInside(parent: string, child: string): boolean;
export declare function normalizeScanPath(file: string, root: string): string;
export declare function normalizeRelPath(file: string): string;
export declare function normalizeFindingPaths(findings: Finding[], root: string): Finding[];
//# sourceMappingURL=files.d.ts.map