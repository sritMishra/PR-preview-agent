import type { Octokit } from '@octokit/rest';

// Identifies one pull request. We pass this around instead of three loose
// args so pr.ts and (later) review.ts share one consistent shape.
export type PullContext = {
  owner: string;
  repo: string;
  prNumber: number;
};

/**
 * The raw unified diff for a PR, as plain text.
 *
 * Same endpoint as "get a pull request", but `mediaType.format: 'diff'` sets
 * the `Accept: application/vnd.github.diff` header, so GitHub returns the diff
 * TEXT (the `diff --git … @@ …` you'd see from `git diff`) instead of JSON.
 *
 * Octokit's types assume the JSON shape, so we cast through `unknown` to
 * `string` — this is the one documented spot where the response type doesn't
 * match the default typings.
 */
export async function fetchPullRequestDiff(
  octokit: Octokit,
  { owner, repo, prNumber }: PullContext,
): Promise<string> {
  const response = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: { format: 'diff' },
  });

  return response.data as unknown as string;
}

// The subset of file metadata we care about. GitHub returns more; we keep the
// fields useful for filtering (Phase 4) and anchoring comments.
export type ChangedFile = {
  filename: string;
  status: string; // 'added' | 'modified' | 'removed' | 'renamed' | …
  additions: number;
  deletions: number;
  changes: number;
  patch?: string; // per-file diff hunk; absent for binary/huge files
};

/**
 * Every file touched by the PR.
 *
 * `octokit.paginate` walks ALL pages for us: the list endpoint returns 30 files
 * per page by default, and a big PR has many pages. paginate keeps requesting
 * until there are none left, then hands back one flat array — so we never miss
 * files just because a PR is large.
 */
export async function fetchChangedFiles(
  octokit: Octokit,
  { owner, repo, prNumber }: PullContext,
): Promise<ChangedFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100, // bigger pages = fewer round trips
  });

  return files.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    patch: f.patch,
  }));
}

// An inline review comment already on the PR (from any prior review).
export type ExistingReviewComment = {
  id: number;
  path: string;
  line: number | null; // null if the comment is on outdated code
  body: string;
  author: string;
};

/**
 * Inline review comments already posted on the PR.
 *
 * We fetch these so that later, on a re-run (a `synchronize` event when new
 * commits land), we can avoid posting the same comment twice — idempotency,
 * PROJECT_PLAN §7 principle #4. Not used until Phase 6, but the read belongs
 * here with the other PR reads.
 */
export async function fetchExistingReviewComments(
  octokit: Octokit,
  { owner, repo, prNumber }: PullContext,
): Promise<ExistingReviewComment[]> {
  const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  return comments.map((c) => ({
    id: c.id,
    path: c.path,
    line: c.line ?? null,
    body: c.body,
    author: c.user?.login ?? 'unknown',
  }));
}
