import { type DynamicCheck as DynamicCheckType } from './config/schema.js';
export declare function parseMaxIterations(raw: string): number;
export declare function parseMaxCostUsd(raw: string): number;
export declare function parseMaxWallTimeMinutes(raw: string): number;
export declare function parseTimeoutSeconds(raw: string): number;
/** PR/runtime job budget for scanners + probes (GitHub Actions can run longer single steps). */
export declare function parseRuntimePrTimeoutSeconds(raw: string): number;
export declare function parseMaxRequests(raw: string): number;
export declare function parseMaxCrawlPages(raw: string): number;
export declare function parseRateLimit(raw: string): number;
export declare function parseAttackProvider(raw: string): "anthropic" | "openai" | "google";
/** Parse `Name: value` headers for authenticated Layer 4 probes (repeatable CLI `-H`). */
export declare function parseAuthHeaderLine(raw: string): {
    name: string;
    value: string;
};
export declare function authHeadersFromCliList(lines: string[] | undefined): Record<string, string> | undefined;
/** JSON object of header names → values (CI secret / env). Values must be strings. */
export declare function parseAuthHeadersJson(raw: string | undefined): Record<string, string> | undefined;
export declare function parseDynamicChecks(raw: string): DynamicCheckType[];
