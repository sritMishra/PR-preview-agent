import type { Octokit } from '@octokit/rest';

import type { PullContext } from './pr.js';

// One inline comment, pinned to a line in a file.
//   line — a line number in the NEW version of the file...
//   side — ...unless side is 'LEFT' (the old version). Defaults to 'RIGHT'.
// The line MUST appear in the PR's diff, or GitHub rejects the whole review
// with a 422 — see the note on postReview below.
export type InlineComment = {
  path: string;
  line: number;
  side?: 'RIGHT' | 'LEFT';
  body: string;
};

// COMMENT leaves feedback and gates nothing. APPROVE / REQUEST_CHANGES are
// merge verdicts we deliberately never send automatically in v1 (PROJECT_PLAN
// §7 principle #1 — a human owns that call). The type lists them for honesty,
// but our callers pass 'COMMENT'.
export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

export type PostReviewInput = {
  body: string; // the top-level summary
  event?: ReviewEvent; // defaults to COMMENT
  comments?: InlineComment[]; // inline comments; may be empty
};

export type PostedReview = {
  id: number;
  htmlUrl: string;
};

/**
 * Post a single GitHub Review (summary + inline comments) in one call.
 *
 * All inline comments ride along in the same request via `comments[]`. If ANY
 * of them anchors to a line GitHub can't locate in the diff, the ENTIRE call
 * fails with 422 — GitHub does not partially accept a review. (Phase 6 adds a
 * summary-only fallback for that case; for now we simply pick valid lines.)
 */
export async function postReview(
  octokit: Octokit,
  { owner, repo, prNumber }: PullContext,
  { body, event = 'COMMENT', comments = [] }: PostReviewInput,
): Promise<PostedReview> {
  const response = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    body,
    event,
    comments: comments.map((c) => ({
      path: c.path,
      line: c.line,
      side: c.side ?? 'RIGHT',
      body: c.body,
    })),
  });

  return { id: response.data.id, htmlUrl: response.data.html_url };
}
