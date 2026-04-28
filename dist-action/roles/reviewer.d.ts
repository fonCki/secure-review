import type { ModelAdapter } from '../adapters/types.js';
import type { ReviewerRef } from '../config/schema.js';
import type { Finding } from '../findings/schema.js';
import { type FileContent } from '../util/files.js';
export interface ReviewerRunInput {
    reviewer: ReviewerRef;
    adapter: ModelAdapter;
    skill: string;
    files: FileContent[];
    priorFindings?: Finding[];
}
export interface ReviewerRunOutput {
    reviewer: string;
    status: 'ok' | 'failed';
    findings: Finding[];
    rawText: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        costUSD: number;
    };
    durationMs: number;
    error?: string;
}
export declare function runReviewer(input: ReviewerRunInput): Promise<ReviewerRunOutput>;
//# sourceMappingURL=reviewer.d.ts.map