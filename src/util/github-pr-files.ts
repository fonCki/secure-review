import type { Octokit } from '@octokit/rest';

export type PullRequestFile = Awaited<ReturnType<Octokit['pulls']['listFiles']>>['data'][number];

export async function listPullRequestFiles(
  octokit: Octokit,
  params: {
    owner: string;
    repo: string;
    pull_number: number;
  },
): Promise<PullRequestFile[]> {
  return octokit.paginate(octokit.pulls.listFiles, {
    ...params,
    per_page: 100,
  });
}
