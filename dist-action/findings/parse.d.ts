import { type Finding } from './schema.js';
/**
 * Extract JSON from a model response. Models often wrap JSON in prose or
 * markdown fences; we tolerate both. As a final fallback we try
 * `jsonrepair` which can fix single-quoted strings, trailing commas,
 * truncated arrays, unescaped newlines in strings, and other common
 * model-generated JSON flaws.
 */
export declare function extractJson(text: string): unknown;
export declare function parseFindings(text: string, reviewerName: string): Finding[];
//# sourceMappingURL=parse.d.ts.map