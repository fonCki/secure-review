import type { ReviewerRunOutput } from '../roles/reviewer.js';

export type ReviewHealthStatus = 'ok' | 'degraded' | 'failed';

export interface ReviewHealthSummary {
  reviewStatus: ReviewHealthStatus;
  failedReviewers: string[];
  succeededReviewers: string[];
}

export function summarizeReviewHealth(runs: ReviewerRunOutput[]): ReviewHealthSummary {
  const failed = new Set<string>();
  const succeeded = new Set<string>();

  for (const run of runs) {
    if (run.status === 'failed') failed.add(run.reviewer);
    else succeeded.add(run.reviewer);
  }

  let reviewStatus: ReviewHealthStatus = 'ok';
  if (failed.size > 0 && succeeded.size === 0) reviewStatus = 'failed';
  else if (failed.size > 0) reviewStatus = 'degraded';

  return {
    reviewStatus,
    failedReviewers: Array.from(failed),
    succeededReviewers: Array.from(succeeded),
  };
}
