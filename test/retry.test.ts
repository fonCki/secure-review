import { describe, it, expect, vi } from 'vitest';
import { withRetry, isTransientProviderError } from '../src/util/retry.js';

describe('isTransientProviderError', () => {
  it('treats 5xx as transient', () => {
    expect(isTransientProviderError({ status: 503 })).toBe(true);
    expect(isTransientProviderError({ status: 502 })).toBe(true);
    expect(isTransientProviderError({ status: 500 })).toBe(true);
  });

  it('treats 429 as transient', () => {
    expect(isTransientProviderError({ status: 429 })).toBe(true);
  });

  it('does NOT treat 4xx (not 429) as transient', () => {
    expect(isTransientProviderError({ status: 400 })).toBe(false);
    expect(isTransientProviderError({ status: 401 })).toBe(false);
    expect(isTransientProviderError({ status: 404 })).toBe(false);
  });

  it('treats common error codes as transient', () => {
    expect(isTransientProviderError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTransientProviderError({ code: 'ECONNRESET' })).toBe(true);
  });

  it('detects 503 / rate limit / overloaded in message', () => {
    expect(isTransientProviderError({ message: '[503 Service Unavailable]' })).toBe(true);
    expect(isTransientProviderError({ message: 'rate limit exceeded' })).toBe(true);
    expect(isTransientProviderError({ message: 'model experiencing high demand' })).toBe(true);
    expect(isTransientProviderError({ message: 'the server is overloaded' })).toBe(true);
  });

  it('does NOT treat regular errors as transient', () => {
    expect(isTransientProviderError({ message: 'bad request' })).toBe(false);
    expect(isTransientProviderError(null)).toBe(false);
    expect(isTransientProviderError(undefined)).toBe(false);
  });
});

describe('withRetry', () => {
  it('succeeds on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3, initialDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors up to maxAttempts', async () => {
    const err = Object.assign(new Error('503 high demand'), { status: 503 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3, initialDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry non-transient errors', async () => {
    const err = Object.assign(new Error('bad api key'), { status: 401 });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { maxAttempts: 3, initialDelayMs: 1 })).rejects.toThrow('bad api key');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries and rethrows after maxAttempts', async () => {
    const err = Object.assign(new Error('503'), { status: 503 });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { maxAttempts: 2, initialDelayMs: 1 })).rejects.toThrow('503');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
