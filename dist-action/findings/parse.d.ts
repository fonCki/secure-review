import { type Finding } from './schema.js';
/**
 * Extract JSON from a model response. Models often wrap JSON in prose or
 * markdown fences; we tolerate both.
 */
export declare function extractJson(text: string): unknown;
export declare function parseFindings(text: string, reviewerName: string): Finding[];
//# sourceMappingURL=parse.d.ts.map