import { getInstallationOctokit } from './github/app.js';
import { fetchChangedFiles, fetchPullRequestDiff } from './github/pr.js';
import { postReview } from './github/review.js';

// Everything needed to review one PR. The webhook builds this from the event
// payload and hands it over — the webhook never touches Octokit itself.
export type ReviewRequest = {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
};

/**
 * THE SEAM. Today this does the Phase 2 dummy flow: authenticate → read the PR
 * → post a placeholder review. In Phase 3 the body becomes a LangGraph run
 * (ingest → analyze → interrupt for approval → post) — but the signature and
 * the webhook's call site stay exactly the same.
 */
export async function reviewPullRequest(req: ReviewRequest): Promise<void> {
  // Mint the room-key token for THIS installation (id came off the webhook).
  const octokit = getInstallationOctokit(req.installationId);
  const ctx = { owner: req.owner, repo: req.repo, prNumber: req.prNumber };

  // Read the PR — proving the wired-up read path works, not just the scripts.
  const files = await fetchChangedFiles(octokit, ctx);
  const diff = await fetchPullRequestDiff(octokit, ctx);

  // A summary-only review (no inline comments yet). Anchoring inline comments
  // to real diff lines is Phase 4 work; here we just prove the round trip and
  // echo back what we read, so we can see the read actually happened.
  const summary =
    `👋 Automated plumbing test (Phase 2).\n\n` +
    `I read this PR: **${files.length} file(s) changed**, ` +
    `**${diff.split('\n').length} diff lines**. No real review yet — ` +
    `this confirms the webhook → auth → read → post pipeline is wired.`;

  const result = await postReview(octokit, ctx, { body: summary, event: 'COMMENT' });
  console.log(`[review] posted dummy review on PR #${req.prNumber}: ${result.htmlUrl}`);
}
