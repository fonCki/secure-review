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
export declare function readSourceTree(root: string, maxBytesPerFile?: number): Promise<FileContent[]>;
export declare function serializeCodeContext(files: FileContent[], maxChars?: number): string;
export declare function writeFileSafe(path: string, content: string): Promise<void>;
export declare function isPathInside(parent: string, child: string): boolean;
export declare function normalizeScanPath(file: string, root: string): string;
export declare function normalizeFindingPaths(findings: Finding[], root: string): Finding[];
//# sourceMappingURL=files.d.ts.map