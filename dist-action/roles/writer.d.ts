import type { ModelAdapter } from '../adapters/types.js';
import type { ModelRef } from '../config/schema.js';
import type { Finding } from '../findings/schema.js';
import { type FileContent } from '../util/files.js';
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
export declare function runWriter(input: WriterRunInput): Promise<WriterRunOutput>;
//# sourceMappingURL=writer.d.ts.map