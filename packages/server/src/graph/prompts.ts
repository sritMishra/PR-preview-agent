import type { FileChunk } from './chunks.js';

/**
 * The review prompt, as data.
 *
 * WHY THIS IS ITS OWN FILE. A prompt is the most-edited, least-typed part of an
 * LLM feature — it will change dozens of times while tuning (step 20). Keeping
 * it out of the node means it can be printed by verify-prompt.ts, read in a git
 * diff, and changed without touching graph code. Pure: no model, no network,
 * no state.
 */

/**
 * SYSTEM — who the reviewer is and the rules it works under. Identical on every
 * call, so it sits at the top of the message list where it stays stable.
 *
 * Note how much of this is NEGATIVE space. The positive instruction ("find
 * bugs") is the easy half; the hard half is suppressing the four things a model
 * will otherwise do by default — restate the diff, police formatting, praise the
 * author, and speculate confidently about code it cannot see. A review nobody
 * reads because it has forty comments is worse than no review at all
 * (PROJECT_PLAN §7 #2 — signal over noise).
 */
export const SYSTEM_PROMPT = `You are a senior engineer leaving review comments on a GitHub pull request.

You are shown ONE file's changes at a time, rendered as a diff with real line
numbers in a left gutter:
  lines marked '+' were ADDED by this PR
  lines marked '-' were REMOVED by this PR (these have no line number)
  unmarked lines are unchanged context

WHAT TO REPORT — only issues in these five categories:
  correctness  logic errors, unhandled cases, wrong assumptions, broken edge cases
  security     injection, missing authz/authn, leaked secrets, unsafe input handling
  performance  needless work in a loop, N+1 queries, blocking calls on a hot path
  tests        new or changed logic with no corresponding test change in this PR
  readability  naming or structure that will genuinely mislead the next reader

WHAT NOT TO REPORT:
  - anything a linter or formatter already catches (spacing, quotes, semicolons,
    import order, line length)
  - restatements of what the diff plainly shows
  - praise, summaries, or suggestions to "add a comment here"
  - nitpicks the author would reasonably ignore

WHAT YOU CANNOT SEE — read this carefully. You are looking ONLY at the changed
portion of ONE file. You cannot see the rest of that file, any other file, or
the wider codebase. Do not guess what a function you cannot see does, and do not
assume something is missing merely because it is not visible here. If a real
problem depends on something outside your view, you may still report it — but
phrase it as the specific question a human should check, not as a certainty.

CITING LINES. Cite only line numbers that appear in the left gutter, and only on
lines marked '+'. Removed lines cannot be commented on. If an issue spans
several lines, cite the single most relevant one.

SEVERITY:
  high    likely to cause incorrect behaviour, data loss, or a security hole
  medium  a real problem, but bounded in blast radius or unlikely to trigger
  low     worth mentioning; the author may reasonably disagree

CONFIDENCE — a number from 0.0 to 1.0: how sure are you this is a real problem,
given your limited view? Be honest. Low-confidence findings are filtered out
rather than shown, so a hedged guess costs nothing but an inflated score costs
the reader's trust.

Report AT MOST 5 findings for this file, ranked by importance. If nothing here
warrants a human's attention, report nothing at all — an empty result is a valid
and useful answer, and is much better than a manufactured one.

Each finding's body: 1-3 sentences. Say what is wrong and what to do about it.`;

/** Everything one review call needs to know, beyond the system prompt. */
export type PromptInput = {
  /** The file under review: its hunks, its legal line numbers, its rendering. */
  chunk: FileChunk;
  /** Position in the PR — "file 2 of 5" tells the model this isn't the whole story. */
  fileIndex: number;
  fileCount: number;
  /** The other files this PR touches. Cheap, and the only way the model can spot
   *  "logic changed and no test file was touched". */
  otherFiles: string[];
  /** The author's stated intent. Optional: `ingest` does not keep PR metadata
   *  yet, so nothing supplies this today — wire it up in 18b. The prompt simply
   *  omits the line when it's absent. */
  prTitle?: string;
};

/**
 * USER — the payload for one file.
 *
 * The commentable lines are stated TWICE: implicitly by the gutter (a removed
 * line has no number, so it can't be cited by accident) and explicitly as a
 * sentence. Redundant on purpose — it's free, and cheaper than a rejected
 * review. `anchorAll` still validates whatever comes back regardless; belt,
 * braces, and a second pair of braces.
 *
 * No truncation here: the per-file change budget in filters.ts already bounds
 * how big a rendering can get before it ever reaches this function.
 */
export function buildUserPrompt({
  chunk,
  fileIndex,
  fileCount,
  otherFiles,
  prTitle,
}: PromptInput): string {
  const lines: string[] = [];

  if (prTitle) lines.push(`Pull request: "${prTitle}"`, '');

  lines.push(`File ${fileIndex} of ${fileCount}: ${chunk.filename}`);

  if (otherFiles.length) {
    lines.push(`Other files changed in this PR: ${otherFiles.join(', ')}`);
  }

  lines.push('');

  // A file whose changes were all deletions has nowhere to hang a comment. The
  // caller should skip it entirely rather than spend a call — but say so plainly
  // if we ever get here, instead of printing an empty allow-list.
  lines.push(
    chunk.commentableLines.length
      ? `You may comment ONLY on these lines: ${chunk.commentableLines.join(', ')}`
      : `This file has no commentable lines (its changes are deletions only).`,
    '',
    chunk.numbered,
  );

  return lines.join('\n');
}
