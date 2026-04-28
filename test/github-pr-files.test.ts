import { describe, expect, it, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import { listPullRequestFiles } from '../src/util/github-pr-files.js';

describe('listPullRequestFiles', () => {
  it('uses Octokit pagination for PR file lists', async () => {
    const listFiles = vi.fn();
    const paginate = vi.fn(async () => [{ filename: 'a.ts', patch: '@@ -1 +1 @@\n+hi' }]);
    const octokit = {
      pulls: { listFiles },
      paginate,
    } as unknown as Octokit;

    const files = await listPullRequestFiles(octokit, {
      owner: 'o',
      repo: 'r',
      pull_number: 123,
    });

    expect(files).toHaveLength(1);
    expect(paginate).toHaveBeenCalledWith(listFiles, {
      owner: 'o',
      repo: 'r',
      pull_number: 123,
      per_page: 100,
    });
  });
});
