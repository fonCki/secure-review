import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from 'commander';
import {
  authHeadersFromCliList,
  parseAuthHeaderLine,
  parseDynamicChecks,
  parseMaxCostUsd,
  parseMaxCrawlPages,
  parseMaxIterations,
  parseMaxRequests,
  parseMaxWallTimeMinutes,
  parseAttackProvider,
  parseRateLimit,
  parseTimeoutSeconds,
} from '../src/cli.js';

describe('parseAuthHeaderLine', () => {
  it('parses Name: value', () => {
    expect(parseAuthHeaderLine('Cookie: a=b')).toEqual({ name: 'Cookie', value: 'a=b' });
    expect(parseAuthHeaderLine(' Authorization: Bearer x.y.z ')).toEqual({
      name: 'Authorization',
      value: 'Bearer x.y.z',
    });
  });

  it('rejects malformed lines', () => {
    expect(() => parseAuthHeaderLine('no-colon')).toThrow(InvalidArgumentError);
    expect(() => parseAuthHeaderLine(':only-value')).toThrow(InvalidArgumentError);
  });
});

describe('authHeadersFromCliList', () => {
  it('builds a header map', () => {
    expect(authHeadersFromCliList(['Cookie: x=1', 'X-Test: y'])).toEqual({
      Cookie: 'x=1',
      'X-Test': 'y',
    });
    expect(authHeadersFromCliList(undefined)).toBeUndefined();
    expect(authHeadersFromCliList([])).toBeUndefined();
  });
});

describe('parseMaxIterations', () => {
  it.each([
    ['5', 5],
    ['1', 1],
    ['10', 10],
  ])('parses %s', (raw, expected) => {
    expect(parseMaxIterations(raw)).toBe(expected);
  });

  it.each(['abc', '0', '-1', '11', '1.5', '', 'NaN'])('rejects %s', (raw) => {
    expect(() => parseMaxIterations(raw)).toThrow(InvalidArgumentError);
  });
});

describe('parseMaxCostUsd', () => {
  it.each([
    ['0', 0],
    ['0.01', 0.01],
    ['5', 5],
  ])('parses %s', (raw, expected) => {
    expect(parseMaxCostUsd(raw)).toBe(expected);
  });

  it.each(['abc', '-1', '', 'NaN', 'Infinity'])('rejects %s', (raw) => {
    expect(() => parseMaxCostUsd(raw)).toThrow(InvalidArgumentError);
  });
});

describe('parseMaxWallTimeMinutes', () => {
  it.each([
    ['0.5', 0.5],
    ['30', 30],
    ['90', 90],
  ])('parses %s', (raw, expected) => {
    expect(parseMaxWallTimeMinutes(raw)).toBe(expected);
  });

  it.each(['abc', '0', '-1', '', 'NaN', 'Infinity'])('rejects %s', (raw) => {
    expect(() => parseMaxWallTimeMinutes(raw)).toThrow(InvalidArgumentError);
  });
});

describe('parseTimeoutSeconds', () => {
  it.each([
    ['1', 1],
    ['30', 30],
    ['600', 600],
  ])('parses %s', (raw, expected) => {
    expect(parseTimeoutSeconds(raw)).toBe(expected);
  });

  it.each(['abc', '0', '-1', '601', '1.5', '', 'NaN'])('rejects %s', (raw) => {
    expect(() => parseTimeoutSeconds(raw)).toThrow(InvalidArgumentError);
  });
});

describe('parseMaxRequests', () => {
  it.each([
    ['1', 1],
    ['25', 25],
    ['500', 500],
  ])('parses %s', (raw, expected) => {
    expect(parseMaxRequests(raw)).toBe(expected);
  });

  it.each(['0', '-1', '501', 'abc', '', '1.5'])('rejects %s', (raw) => {
    expect(() => parseMaxRequests(raw)).toThrow(InvalidArgumentError);
  });
});

describe('parseMaxCrawlPages', () => {
  it.each([
    ['1', 1],
    ['10', 10],
    ['100', 100],
  ])('parses %s', (raw, expected) => {
    expect(parseMaxCrawlPages(raw)).toBe(expected);
  });

  it.each(['0', '-1', '101', 'abc', ''])('rejects %s', (raw) => {
    expect(() => parseMaxCrawlPages(raw)).toThrow(InvalidArgumentError);
  });
});

describe('parseRateLimit', () => {
  it.each([
    ['0.5', 0.5],
    ['5', 5],
    ['20', 20],
  ])('parses %s', (raw, expected) => {
    expect(parseRateLimit(raw)).toBe(expected);
  });

  it.each(['0', '-1', '21', 'abc', '', 'Infinity'])('rejects %s', (raw) => {
    expect(() => parseRateLimit(raw)).toThrow(InvalidArgumentError);
  });
});

describe('parseAttackProvider', () => {
  it.each([
    ['anthropic', 'anthropic'],
    ['OpenAI', 'openai'],
    ['GOOGLE', 'google'],
  ])('parses %s', (raw, expected) => {
    expect(parseAttackProvider(raw)).toBe(expected);
  });

  it.each(['azure', '', 'AnthropicX'])('rejects %s', (raw) => {
    expect(() => parseAttackProvider(raw)).toThrow(InvalidArgumentError);
  });
});

describe('parseDynamicChecks', () => {
  it('parses comma-separated check names', () => {
    expect(parseDynamicChecks('headers,cookies,cors,sensitive_paths')).toEqual([
      'headers',
      'cookies',
      'cors',
      'sensitive_paths',
    ]);
  });

  it.each(['', 'headers,nope', 'xss'])('rejects invalid checks: %s', (raw) => {
    expect(() => parseDynamicChecks(raw)).toThrow(InvalidArgumentError);
  });
});
