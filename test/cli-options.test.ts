import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from 'commander';
import { parseMaxCostUsd, parseMaxIterations, parseMaxWallTimeMinutes } from '../src/cli.js';

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
