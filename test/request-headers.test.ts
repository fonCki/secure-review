import { describe, expect, it } from 'vitest';
import { mergeAuthHeaders } from '../src/util/request-headers.js';

describe('mergeAuthHeaders', () => {
  it('returns undefined when both inputs empty', () => {
    expect(mergeAuthHeaders(undefined, undefined)).toBeUndefined();
    expect(mergeAuthHeaders({}, {})).toBeUndefined();
  });

  it('merges with override winning', () => {
    expect(
      mergeAuthHeaders({ Cookie: 'a=1', 'X-Foo': 'bar' }, { Cookie: 'a=2' }),
    ).toEqual({ Cookie: 'a=2', 'X-Foo': 'bar' });
  });
});
