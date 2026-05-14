import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEslint } from '../src/sast/eslint.js';

/**
 * Papercut #1: when the target project has no eslint.config.{js,mjs,cjs},
 * ESLint v9 dumps a 13-line migration message either to stderr (local) or
 * causes a JSON-parse error (CI: "Unexpected end of JSON input"). The fix:
 * detect the missing config up-front and return `available: false` with a
 * one-line friendly reason — no subprocess spawn, no wall-of-text.
 */

describe('runEslint — config-missing graceful skip (papercut #1)', () => {
  it('returns available=false with a friendly reason when no eslint.config.* exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-eslint-noconfig-'));
    try {
      writeFileSync(join(dir, 'a.js'), 'console.log(1);\n');
      const result = await runEslint(dir);
      expect(result.available).toBe(false);
      expect(result.findings).toEqual([]);
      // Friendly one-liner, not a wall of text.
      expect(result.error).toBeDefined();
      expect(result.error!.length).toBeLessThan(200);
      expect(result.error).toMatch(/eslint\.config/);
      expect(result.error).not.toMatch(/migration guide/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('walks up parent directories to find an eslint.config.mjs', async () => {
    // ESLint v9 searches up the tree; our pre-check should mirror that so we
    // don't false-negative on a subdirectory whose ancestor has the config.
    const root = mkdtempSync(join(tmpdir(), 'sr-eslint-walk-'));
    const sub = join(root, 'src');
    try {
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(root, 'eslint.config.mjs'), 'export default [];\n');
      writeFileSync(join(sub, 'a.js'), 'console.log(1);\n');
      const result = await runEslint(sub);
      // We don't care about findings (ESLint may not even be installed);
      // we care that the pre-check didn't short-circuit with "no config".
      // If `available` is false here, the error must NOT be the missing-config one.
      if (!result.available) {
        expect(result.error).not.toMatch(/no eslint\.config/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
