import { getInstallationOctokit } from '../github/app.js';
import { fetchChangedFiles, fetchPullRequestDiff } from '../github/pr.js';
import type { InlineComment } from '../github/review.js';
import { postReview } from '../github/review.js';

import { anchorAll, chunkFile } from './chunks.js';
import { filterFiles } from './filters.js';
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

  return { files , diff }
}

/**
 * Node 2 — FILTER AND CHUNK. Decide what is worth reviewing at all.
 *
 * Pure: state in, state out, no I/O. All the real logic lives in filters.ts as
 * plain functions — this node is only the adapter that reads `files` from state
 * and writes the verdict back. That split is why filters.ts can be exercised by
 * verify-filters.ts with neither a network nor a graph.
 *
 * The "chunk" half (step 17b) parses each surviving patch into hunks with real
 * line numbers, so findings can be anchored as inline comments instead of
 * rendered into the summary text. Both halves are pure, so this whole node is a
 * deterministic function of `state.files` — free to retry, trivial to test.
 */
export async function filterAndChunk(state: ReviewStateType): Promise<Partial<ReviewStateType>> {
  const { reviewable, skipped } = filterFiles(state.files);

  // Group skips by reason so the log is one useful line rather than a list.
  const byReason = new Map<string, number>();
  for (const file of skipped) {
    byReason.set(file.reason, (byReason.get(file.reason) ?? 0) + 1);
  }
  const breakdown = [...byReason].map(([reason, n]) => `${n} ${reason}`).join(', ');

  console.log(
    `[graph:filterAndChunk] ${reviewable.length} reviewable, ${skipped.length} skipped` +
      (breakdown ? ` (${breakdown})` : ''),
  );

  // Parse only what survived the filters: chunking a 5,000-line lockfile would
  // be wasted work, and nothing downstream would ever look at it.
  const chunks = reviewable.map(chunkFile);
  const anchorable = chunks.reduce((n, c) => n + c.commentableLines.length, 0);

  console.log(`[graph:filterAndChunk] ${anchorable} commentable line(s) across ${chunks.length} file(s)`);

  return { reviewableFiles: reviewable, skippedFiles: skipped, chunks };
}

/**
 * Node 3 — AGGREGATE. Turn what we read into findings + a summary.
 *
 * Phase 4 replaces this body with the LLM fan-out. Everything downstream is
 * written against `findings` and `summary`, so when that swap happens, `post`
 * does not change at all. That's the value of stubbing at the state boundary
 * rather than skipping the node.
 */
export async function aggregate(state: ReviewStateType): Promise<Partial<ReviewStateType>> {
  // Still fabricated — no LLM until step 18 — but the LINE is now real: the
  // first line this PR actually added to the file, straight from the line map.
  // Files whose changes were all deletions have nothing to anchor to, so
  // flatMap drops them rather than inventing a line.
  //
  // Annotating as Finding[] (rather than letting TS infer) is what keeps
  // `severity: 'low'` typed as the literal 'low' instead of widening to string.
  const drafts: Finding[] = state.chunks.slice(0, 3).flatMap((chunk) => {
    const line = chunk.commentableLines[0];
    if (line === undefined) return [];
    return [
      {
        path: chunk.filename,
        line,
        severity: 'low' as const,
        category: 'readability' as const,
        body: `Stubbed finding — anchored to the first line this PR added here (line ${line}). No LLM yet.`,
      },
    ];
  });

  // The gate. Every finding is checked against the line map, near misses snap,
  // and anything unanchorable is demoted to a summary bullet instead of being
  // dropped (§7 #5). Today's stubs always pass — they were built FROM the map —
  // but the path has to be live before step 18, when an LLM starts guessing.
  const { anchored: findings, unanchored } = anchorAll(drafts, state.chunks);

  // Report what we ignored. Silent truncation reads as "I reviewed everything"
  // (PROJECT_PLAN §7 #2 — signal over noise, but be honest about the noise).
  const skippedNote = state.skippedFiles.length
    ? `\n\n<details><summary>Skipped ${state.skippedFiles.length} file(s)</summary>\n\n` +
      state.skippedFiles.map((f) => `- \`${f.filename}\` — _${f.reason}_`).join('\n') +
      `\n\n</details>`
    : '';

  // Demoted findings: couldn't be anchored, so they ride in the summary rather
  // than being lost.
  const demotedNote = unanchored.length
    ? `\n\n**${unanchored.length} finding(s) could not be anchored to a diff line:**\n` +
      unanchored.map((f) => `- \`${f.path}\` — ${f.body}`).join('\n')
    : '';

  const anchorable = state.chunks.reduce((n, c) => n + c.commentableLines.length, 0);

  const summary =
    `🤖 **Phase 4, step 17b — real line anchoring.**\n\n` +
    `Graph: \`ingest → filterAndChunk → aggregate → post\`. Of the ` +
    `**${state.files.length} changed file(s)** GitHub reported I kept ` +
    `**${state.reviewableFiles.length}**, parsed their diffs into ` +
    `**${anchorable} commentable line(s)**, and left ` +
    `**${findings.length} inline comment(s)** below — each pinned to a line this ` +
    `PR actually added. Still no LLM; the bodies are stubs, the anchors are real.` +
    demotedNote +
    skippedNote;

  return { findings, summary };
}

/**
 * Node 4 — POST. Publish the summary AND the inline comments as one review.
 *
 * `aggregate` has already validated every line against the map, so these should
 * all be accepted. Should. GitHub is the final authority on what's in the diff,
 * and it rejects the ENTIRE review — summary included — if it disagrees about a
 * single line. So we retry once with the comments stripped rather than lose the
 * whole review to one bad anchor. (That fallback is PROJECT_PLAN step 29; pulled
 * forward to here because this is the first time we send real anchors at all.)
 */
export async function post(state: ReviewStateType): Promise<Partial<ReviewStateType>> {
  const octokit = getInstallationOctokit(state.installationId);
  const ctx = { owner: state.owner, repo: state.repo, prNumber: state.prNumber };

  const comments: InlineComment[] = state.findings.map((f) => ({
    path: f.path,
    line: f.line,
    side: 'RIGHT', // the head version of the file — see github/review.ts
    body: `**${f.category} · ${f.severity}** — ${f.body}`,
  }));

  try {
    const { htmlUrl } = await postReview(octokit, ctx, {
      body: state.summary,
      event: 'COMMENT',
      comments,
    });

    console.log(
      `[graph:post] posted review on PR #${state.prNumber} with ${comments.length} inline comment(s): ${htmlUrl}`,
    );

    return { postedReviewUrl: htmlUrl };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[graph:post] inline comments rejected, retrying summary-only: ${reason}`);

    const { htmlUrl } = await postReview(octokit, ctx, {
      body: `${state.summary}\n\n> ⚠️ Inline comments were rejected by GitHub and omitted.`,
      event: 'COMMENT',
    });

    // The error goes into state, not just the console: `errors` uses a concat
    // reducer so a failure is recorded without discarding what worked.
    return { postedReviewUrl: htmlUrl, errors: [`post: inline comments rejected — ${reason}`] };
  }
}
