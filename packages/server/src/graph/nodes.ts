import { getInstallationOctokit } from '../github/app.js';
import { fetchChangedFiles, fetchPullRequestDiff } from '../github/pr.js';
import { postReview } from '../github/review.js';

import type { Finding, ReviewStateType } from './state.js';

/**
 * Node 1 — INGEST. Read everything we need from GitHub into state.
 *
 * Note what a node signature is: state in, PARTIAL state out. Returning
 * `{ files, diff }` doesn't replace the state — LangGraph merges those two
 * channels in (using the reducers from state.ts) and leaves the rest alone.
 */
export async function ingest(state: ReviewStateType): Promise<Partial<ReviewStateType>> {
  // Re-derive the client from the id in state. The client itself can't live in
  // state — the checkpointer has to serialize state, and a live HTTP client
  // isn't JSON.
  const octokit = getInstallationOctokit(state.installationId);
  const ctx = { owner: state.owner, repo: state.repo, prNumber: state.prNumber };

  // Two independent reads → fire them together rather than one after the other.
  const [files, diff] = await Promise.all([
    fetchChangedFiles(octokit, ctx),
    fetchPullRequestDiff(octokit, ctx),
  ]);

  console.log(
    `[graph:ingest] PR #${state.prNumber} — ${files.length} file(s), ${diff.split('\n').length} diff lines`,
  );

  return { files, diff };
}

/**
 * Node 2 — AGGREGATE. Turn what we read into findings + a summary.
 *
 * Phase 4 replaces this body with the LLM fan-out. Everything downstream is
 * written against `findings` and `summary`, so when that swap happens, `post`
 * does not change at all. That's the value of stubbing at the state boundary
 * rather than skipping the node.
 */
export async function aggregate(state: ReviewStateType): Promise<Partial<ReviewStateType>> {
  // Annotating as Finding[] (rather than letting TS infer) is what keeps
  // `severity: 'low'` typed as the literal 'low' instead of widening to string.
  const findings: Finding[] = state.files.slice(0, 3).map((file) => ({
    path: file.filename,
    line: 1,
    severity: 'low',
    category: 'readability',
    body: `Stubbed finding — ${file.changes} line(s) changed here. No LLM yet.`,
  }));

  const summary =
    `🤖 **Phase 3 — LangGraph skeleton.**\n\n` +
    `This review was produced by a compiled graph (\`ingest → aggregate → post\`), ` +
    `not a straight-line function. I read **${state.files.length} file(s)** / ` +
    `**${state.diff.split('\n').length} diff lines** and fabricated ` +
    `**${findings.length} stub finding(s)**:\n\n` +
    findings.map((f) => `- \`${f.path}\` — _${f.category}/${f.severity}_ — ${f.body}`).join('\n');

  return { findings, summary };
}

/**
 * Node 3 — POST. Publish the summary as a GitHub review.
 *
 * Still summary-only: findings are rendered INTO the summary text rather than
 * sent as inline `comments[]`. Anchoring a comment to a real diff line is
 * Phase 4 work, and one bad anchor 422s the entire review (github/review.ts).
 * Rendering them inline-in-text lets us SEE that findings survived the trip
 * through state without risking the call.
 */
export async function post(state: ReviewStateType): Promise<Partial<ReviewStateType>> {
  const octokit = getInstallationOctokit(state.installationId);
  const ctx = { owner: state.owner, repo: state.repo, prNumber: state.prNumber };

  const { htmlUrl } = await postReview(octokit, ctx, {
    body: state.summary,
    event: 'COMMENT',
  });

  console.log(`[graph:post] posted review on PR #${state.prNumber}: ${htmlUrl}`);

  return { postedReviewUrl: htmlUrl };
}
