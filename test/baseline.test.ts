import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  applyBaseline,
  baselineFromFindings,
  loadBaseline,
  mergeBaseline,
  saveBaseline,
} from '../src/findings/baseline.js';
import type { Finding } from '../src/findings/schema.js';

function mk(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-00',
    severity: 'HIGH',
    file: 'src/a.ts',
    lineStart: 10,
    lineEnd: 12,
    title: 'thing',
    description: 'desc',
    reportedBy: ['x'],
    confidence: 0.5,
    ...overrides,
  };
}

describe('baselineFromFindings', () => {
  it('captures one entry per unique fingerprint', () => {
    const baseline = baselineFromFindings([
      mk({ file: 'src/a.ts', lineStart: 10 }),
      mk({ file: 'src/a.ts', lineStart: 12 }), // same fingerprint as above
      mk({ file: 'src/b.ts', lineStart: 10 }),
    ]);
    expect(baseline.entries).toHaveLength(2);
    expect(baseline.entries.map((e) => e.fingerprint).sort()).toEqual([
      'src/a.ts::1',
      'src/b.ts::1',
    ]);
  });

  it('annotates each entry with human-readable context', () => {
    const baseline = baselineFromFindings(
      [mk({ file: 'src/a.ts', lineStart: 10, title: 'Hardcoded creds', cwe: 'CWE-798', severity: 'CRITICAL' })],
      'test fixture',
    );
    const e = baseline.entries[0]!;
    expect(e.title).toBe('Hardcoded creds');
    expect(e.cwe).toBe('CWE-798');
    expect(e.severity).toBe('CRITICAL');
    expect(e.reason).toBe('test fixture');
    expect(e.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('applyBaseline', () => {
  it('suppresses findings whose fingerprint matches and keeps the rest', () => {
    const baseline = baselineFromFindings([mk({ file: 'src/a.ts', lineStart: 10 })]);
    const findings = [
      mk({ file: 'src/a.ts', lineStart: 11 }), // same fingerprint as baseline
      mk({ file: 'src/a.ts', lineStart: 50 }), // different fingerprint
      mk({ file: 'src/b.ts', lineStart: 10 }),
    ];
    const { kept, suppressed } = applyBaseline(findings, baseline);
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]!.lineStart).toBe(11);
    expect(kept).toHaveLength(2);
  });

  it('is a no-op when baseline is undefined or empty', () => {
    const findings = [mk(), mk({ file: 'src/b.ts' })];
    expect(applyBaseline(findings, undefined).kept).toHaveLength(2);
    expect(applyBaseline(findings, baselineFromFindings([])).kept).toHaveLength(2);
  });
});

describe('mergeBaseline', () => {
  it('preserves prior reasons/timestamps and appends only new fingerprints', async () => {
    const original = baselineFromFindings([mk({ file: 'src/a.ts', lineStart: 10 })], 'original-reason');
    const originalAcceptedAt = original.entries[0]!.acceptedAt!;
    // Wait a tick so updatedAt diverges from createdAt
    await new Promise((r) => setTimeout(r, 5));
    const merged = mergeBaseline(
      original,
      [
        mk({ file: 'src/a.ts', lineStart: 11 }), // same fingerprint — already known
        mk({ file: 'src/c.ts', lineStart: 200 }), // new
      ],
      'new-reason',
    );
    expect(merged.entries).toHaveLength(2);
    const preexisting = merged.entries.find((e) => e.fingerprint === 'src/a.ts::1')!;
    expect(preexisting.reason).toBe('original-reason'); // NOT overwritten
    expect(preexisting.acceptedAt).toBe(originalAcceptedAt);
    const added = merged.entries.find((e) => e.fingerprint === 'src/c.ts::20')!;
    expect(added.reason).toBe('new-reason');
    expect(merged.updatedAt).not.toBe(merged.createdAt);
  });
});

describe('saveBaseline / loadBaseline round-trip', () => {
  it('writes and reads a valid baseline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-baseline-'));
    const path = join(dir, 'baseline.json');
    const baseline = baselineFromFindings([mk()], 'unit test');
    await saveBaseline(path, baseline);
    const onDisk = await readFile(path, 'utf8');
    expect(onDisk).toContain('"schemaVersion": 1');
    const loaded = await loadBaseline(path);
    expect(loaded?.entries).toHaveLength(1);
    expect(loaded?.entries[0]!.fingerprint).toBe(baseline.entries[0]!.fingerprint);
  });

  it('returns undefined when the file does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-baseline-'));
    expect(await loadBaseline(join(dir, 'missing.json'))).toBeUndefined();
  });
});
