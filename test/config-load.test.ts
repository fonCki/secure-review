import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config/load.js';

describe('loadConfig', () => {
  it('loads and validates a YAML config file', async () => {
    const dir = join(tmpdir(), `secure-review-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, '.secure-review.yml');
    await writeFile(
      path,
      `writer:
  provider: anthropic
  model: claude-sonnet-4-6
  skill: skills/w.md
reviewers:
  - name: a
    provider: openai
    model: gpt-5
    skill: skills/a.md
`,
      'utf8',
    );
    const loaded = await loadConfig(path);
    expect(loaded.config.reviewers).toHaveLength(1);
    expect(loaded.config.reviewers[0].name).toBe('a');
    expect(loaded.config.fix.max_iterations).toBe(3);
    expect(loaded.configDir).toBe(dir);
  });

  it('throws on invalid config', async () => {
    const dir = join(tmpdir(), `secure-review-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, '.secure-review.yml');
    await writeFile(path, `reviewers: []\n`, 'utf8');
    await expect(loadConfig(path)).rejects.toThrow(/Invalid config/);
  });
});
