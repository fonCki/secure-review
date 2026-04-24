import { describe, it, expect } from 'vitest';
import { commentableLinesFromPatch, commentableLinesByFile } from '../src/util/diff.js';

describe('commentableLinesFromPatch', () => {
  it('returns empty set for missing patch', () => {
    expect(commentableLinesFromPatch(undefined).size).toBe(0);
    expect(commentableLinesFromPatch('').size).toBe(0);
  });

  it('parses a single-hunk patch with only additions', () => {
    const patch = `@@ -1,3 +1,5 @@
 line1
 line2
+new3
+new4
 line3`;
    expect([...commentableLinesFromPatch(patch)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('excludes deleted lines from the new-file side', () => {
    const patch = `@@ -1,4 +1,3 @@
 line1
-deleted
 line2
 line3`;
    // new file has 3 lines: 1,2,3 — all context or unchanged
    expect([...commentableLinesFromPatch(patch)].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('handles multiple hunks and correct renumbering', () => {
    const patch = `@@ -1,3 +1,4 @@
 a
+added-at-2
 b
 c
@@ -10,3 +11,3 @@
 x
-del
+y
 z`;
    const lines = [...commentableLinesFromPatch(patch)].sort((a, b) => a - b);
    // hunk 1: new lines 1,2,3,4  | hunk 2: new lines 11,12,13 (z is line 13, y is 12, x is 11)
    expect(lines).toEqual([1, 2, 3, 4, 11, 12, 13]);
  });

  it('commentableLinesByFile returns a map', () => {
    const map = commentableLinesByFile([
      { filename: 'a.ts', patch: '@@ -1,1 +1,2 @@\n line\n+added' },
      { filename: 'b.ts' },
    ]);
    expect(map.get('a.ts')?.size).toBe(2);
    expect(map.get('b.ts')?.size).toBe(0);
  });
});
