import { describe, expect, it, vi } from 'vitest';
import { extractJson, parseFindings } from '../src/findings/parse.js';

describe('extractJson', () => {
  it('parses bare JSON', () => {
    expect(extractJson('{"findings": []}')).toEqual({ findings: [] });
  });

  it('parses JSON inside markdown fences', () => {
    const text = 'Here you go:\n```json\n{"findings":[{"severity":"HIGH","file":"a.ts","line":1,"title":"t","description":"d"}]}\n```';
    const out = extractJson(text) as { findings: Array<{ severity: string }> };
    expect(out.findings[0].severity).toBe('HIGH');
  });

  it('parses JSON from surrounding prose', () => {
    const text = 'Some thoughts, and then:\n{"findings":[]}\nThanks.';
    expect(extractJson(text)).toEqual({ findings: [] });
  });

  it('throws on no JSON', () => {
    expect(() => extractJson('just text')).toThrow();
  });
});

describe('parseFindings', () => {
  it('normalizes severity casing', () => {
    const raw = JSON.stringify({
      findings: [
        { severity: 'Critical', file: 'a.ts', line: 10, title: 'x', description: 'y' },
        { severity: 'info', file: 'b.ts', line: 1, title: 'p', description: 'q' },
      ],
    });
    const out = parseFindings(raw, 'r1');
    expect(out[0].severity).toBe('CRITICAL');
    expect(out[1].severity).toBe('INFO');
    expect(out[0].reportedBy).toEqual(['r1']);
  });

  it('synthesizes missing id and lineEnd', () => {
    const raw = JSON.stringify({
      findings: [
        { severity: 'HIGH', file: 'a.ts', line: 7, title: 't', description: 'd' },
      ],
    });
    const out = parseFindings(raw, 'r1');
    expect(out[0].id).toBe('F-01');
    expect(out[0].lineStart).toBe(7);
    expect(out[0].lineEnd).toBe(7);
  });

  it('accepts a raw array at the top level', () => {
    const raw = JSON.stringify([
      { severity: 'LOW', file: 'a.ts', line: 1, title: 't', description: 'd' },
    ]);
    const out = parseFindings(raw, 'r1');
    expect(out).toHaveLength(1);
  });

  it('salvages valid findings when one item is malformed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw = JSON.stringify({
      findings: [
        { severity: 'HIGH', file: 'a.ts', line: 3, title: 'valid', description: 'd' },
        { severity: 'LOW', line: 4, title: 'missing file', description: 'd' },
      ],
    });
    const out = parseFindings(raw, 'r1');
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('valid');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('extractJson — jsonrepair fallback', () => {
  it('repairs single-quoted strings', () => {
    const got = extractJson("{'findings': [{'title': 'x'}]}");
    expect(got).toEqual({ findings: [{ title: 'x' }] });
  });

  it('repairs trailing commas', () => {
    const got = extractJson('{"findings": [{"title": "x"},]}');
    expect(got).toEqual({ findings: [{ title: 'x' }] });
  });

  it('repairs truncated output (missing closing brace)', () => {
    const got = extractJson('{"findings": [{"title": "x"}');
    expect(got).toEqual({ findings: [{ title: 'x' }] });
  });

  it('handles prose prefix + JSON + prose suffix', () => {
    const got = extractJson('Here is my review:\n\n{"findings": [{"title": "x"}]}\n\nThat concludes my analysis.');
    expect(got).toEqual({ findings: [{ title: 'x' }] });
  });
});
