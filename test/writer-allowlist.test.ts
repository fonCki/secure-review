import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWriter } from '../src/roles/writer.js';
import type { CompleteInput, CompleteOutput, ModelAdapter } from '../src/adapters/types.js';
import type { Finding } from '../src/findings/schema.js';

class MockAdapter implements ModelAdapter {
  readonly provider = 'openai' as const;
  readonly mode = 'api' as const;
  readonly model = 'mock';
  constructor(private readonly response: string) {}
  async complete(_input: CompleteInput): Promise<CompleteOutput> {
    return {
      text: this.response,
      usage: { inputTokens: 10, outputTokens: 20, costUSD: 0.001 },
      durationMs: 5,
    };
  }
}

const finding: Finding = {
  id: 'f-1',
  severity: 'HIGH',
  title: 't',
  description: 'd',
  file: 'src/app.ts',
  lineStart: 1,
  lineEnd: 1,
  reportedBy: ['mock'],
  confidence: 1,
};

function adapterFor(file: string, content: string): MockAdapter {
  return new MockAdapter(JSON.stringify({ changes: [{ file, content }] }));
}

describe('runWriter allowlist', () => {
  it('refuses to overwrite an existing .env file outside the allowlist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sr-writer-allow-'));
    const envPath = join(root, '.env');
    writeFileSync(envPath, 'OPENAI_API_KEY=real\n');

    const out = await runWriter({
      writer: { provider: 'openai', model: 'mock' },
      adapter: adapterFor('.env', 'OPENAI_API_KEY=deleted\n'),
      skill: 'be careful',
      root,
      files: [{ path: join(root, 'src/app.ts'), relPath: 'src/app.ts', content: 'original', lines: 1 }],
      findings: [finding],
      allowedFiles: new Set(['src/app.ts']),
    });

    expect(readFileSync(envPath, 'utf8')).toBe('OPENAI_API_KEY=real\n');
    expect(out.filesChanged).toEqual([]);
    expect(out.skipped).toContain('.env');
  });

  it('writes a real source file when it is allowlisted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sr-writer-allow-'));
    const appPath = join(root, 'src/app.ts');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(appPath, 'original');

    const out = await runWriter({
      writer: { provider: 'openai', model: 'mock' },
      adapter: adapterFor('src/app.ts', 'fixed'),
      skill: 'be careful',
      root,
      files: [{ path: appPath, relPath: 'src/app.ts', content: 'original', lines: 1 }],
      findings: [finding],
      allowedFiles: new Set(['src/app.ts']),
    });

    expect(readFileSync(appPath, 'utf8')).toBe('fixed');
    expect(out.filesChanged).toEqual(['src/app.ts']);
    expect(out.skipped).toEqual([]);
  });

  it('always refuses .github workflow writes even when allowlisted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sr-writer-allow-'));
    const workflowPath = join(root, '.github/workflows/foo.yml');
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    writeFileSync(workflowPath, 'name: real\n');

    const out = await runWriter({
      writer: { provider: 'openai', model: 'mock' },
      adapter: adapterFor('.github/workflows/foo.yml', 'name: deleted\n'),
      skill: 'be careful',
      root,
      files: [{ path: workflowPath, relPath: '.github/workflows/foo.yml', content: 'name: real\n', lines: 1 }],
      findings: [{ ...finding, file: '.github/workflows/foo.yml' }],
      allowedFiles: new Set(['.github/workflows/foo.yml']),
    });

    expect(readFileSync(workflowPath, 'utf8')).toBe('name: real\n');
    expect(out.filesChanged).toEqual([]);
    expect(out.skipped).toEqual(['.github/workflows/foo.yml']);
  });

  it('refuses to create a new file that is not allowlisted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sr-writer-allow-'));
    const newPath = join(root, 'src/new.ts');

    const out = await runWriter({
      writer: { provider: 'openai', model: 'mock' },
      adapter: adapterFor('src/new.ts', 'export const x = 1;\n'),
      skill: 'be careful',
      root,
      files: [{ path: join(root, 'src/app.ts'), relPath: 'src/app.ts', content: 'original', lines: 1 }],
      findings: [finding],
      allowedFiles: new Set(['src/app.ts']),
    });

    expect(existsSync(newPath)).toBe(false);
    expect(out.filesChanged).toEqual([]);
    expect(out.skipped).toEqual(['src/new.ts']);
  });
});
