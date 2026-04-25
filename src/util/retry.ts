import { log } from './logger.js';

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
export function isTransientProviderError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as {
    status?: number;
    code?: string;
    message?: string;
    cause?: unknown;
  };
  const status = anyErr.status;
  if (typeof status === 'number' && (status === 429 || (status >= 500 && status < 600))) return true;
  const code = anyErr.code ?? '';
  if (
    ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ECONNABORTED'].includes(code)
  )
    return true;
  // Node global fetch (undici) wraps the real network error in `cause`. Without
  // peeking through it we'd miss legitimate transient TCP errors that surface
  // only as a top-level "fetch failed".
  if (anyErr.cause && isTransientProviderError(anyErr.cause)) return true;
  const msg = (anyErr.message ?? '').toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('service unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('rate limit') ||
    msg.includes('high demand') ||
    msg.includes('temporarily') ||
    msg.includes('timeout') ||
    // Network-layer transients seen in practice (Node fetch / undici / SDKs):
    msg.includes('fetch failed') ||
    msg.includes('connect timeout') ||
    msg.includes('socket hang up') ||
    msg.includes('network error') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('econnaborted') ||
    msg.includes('etimedout')
  );
}

/**
 * Exponential backoff retry for transient provider errors. Non-transient
 * errors are re-thrown immediately so bad API keys, malformed requests,
 * etc. don't waste the cost/time budget.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const initialDelayMs = opts.initialDelayMs ?? 1000;
  const factor = opts.factor ?? 2;
  const label = opts.label ?? 'operation';

  let attempt = 0;
  let delay = initialDelayMs;
  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxAttempts || !isTransientProviderError(err)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(
        `[${label}] transient error on attempt ${attempt}/${maxAttempts}: ${msg.slice(0, 120)} — retrying in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.round(delay * factor);
    }
  }
}
