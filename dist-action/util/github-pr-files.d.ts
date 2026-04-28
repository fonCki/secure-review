import type { Octokit } from '@octokit/rest';
export type PullRequestFile = Awaited<ReturnType<Octokit['pulls']['listFiles']>>['data'][number];
export declare function listPullRequestFiles(octokit: Octokit, params: {
    owner: string;
    repo: string;
    pull_number: number;
}): Promise<PullRequestFile[]>;
//# sourceMappingURL=github-pr-files.d.ts.map