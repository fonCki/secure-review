export interface RetryOptions {
    maxAttempts?: number;
    initialDelayMs?: number;
    factor?: number;
    label?: string;
}
/**
 * Returns true if an error looks like a transient provider-side issue that
 * is worth retrying: 429 (rate limit), 5xx responses, connection resets,
 * and 'high demand' / unavailable / overloaded markers used by various SDKs.
 */
export declare function isTransientProviderError(err: unknown): boolean;
/**
 * Exponential backoff retry for transient provider errors. Non-transient
 * errors are re-thrown immediately so bad API keys, malformed requests,
 * etc. don't waste the cost/time budget.
 */
export declare function withRetry<T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T>;
//# sourceMappingURL=retry.d.ts.map