import type { ChangedFile } from '../github/pr.js';

/**
 * Diff parsing: turn GitHub's `patch` text into line numbers we can anchor
 * inline comments to.
 *
 * WHY THIS FILE EXISTS. `postReview` sends every inline comment in ONE API call
 * and GitHub accepts all of them or none. A single comment pointing at a line
 * that isn't in the diff fails the whole review with a 422 — summary included.
 * So we never guess a line number; we precompute the legal ones from the diff.
 *
 * Pure functions only — no I/O, no state, no LangGraph. Exercised by
 * verify-chunks.ts without a network or an API key.
 */

/** One line of a hunk body, with its position on each side of the diff. */
export type DiffLine = {
  kind: 'add' | 'del' | 'context';
  oldLine: number | null; // null on added lines — they don't exist in the old file
  newLine: number | null; // null on deleted lines — they don't exist in the new file
  content: string; // the text, WITHOUT the leading '+', '-' or ' '
};

/** One `@@ … @@` block: a contiguous region of change plus its context. */
export type Hunk = {
  header: string; // the raw '@@ …' line; its trailing text is often the enclosing function
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

export type FileChunk = {
  filename: string;
  hunks: Hunk[];
  // Right-side line numbers we may anchor a comment to.
  //
  // An ARRAY, not a Set — even though membership testing is the only thing we
  // ever do with it. This lands in a state channel, and state has to survive
  // JSON.stringify; a Set serializes to `{}` and silently comes back empty.
  // (Same rule that keeps the Octokit client out of state — see graph/state.ts.)
  // Callers doing many lookups build their own Set locally.
  commentableLines: number[];
  // The file rendered with real line numbers in a gutter, ready to drop into a
  // prompt. See renderNumbered below for why this shape.
  numbered: string;
};

// `@@ -oldStart,oldLines +newStart,newLines @@ optional section heading`
//
// Both counts are OPTIONAL: unified diff omits them when they're 1, so
// `@@ -1 +1 @@` is legal and means one line on each side. Forgetting that is
// the classic diff-parser bug — it makes every subsequent line number wrong.
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse one file's patch into hunks, assigning every line its true position in
 * the old and new files.
 *
 * The walk is the whole trick: start the two counters at the header's declared
 * starts, then advance them per line — context advances both, '+' advances only
 * the new side, '-' advances only the old side.
 */
export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    const header = HUNK_HEADER.exec(raw);

    if (header) {
      current = {
        header: raw,
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      hunks.push(current);
      oldLine = current.oldStart;
      newLine = current.newStart;
      continue;
    }

    // Anything before the first hunk header is git's file preamble
    // ('diff --git', '--- a/x', '+++ b/x'). GitHub's per-file `patch` usually
    // starts straight at '@@', but skipping is free insurance.
    if (!current) continue;

    // '\ No newline at end of file' is an ANNOTATION about the previous line,
    // not a line of the file. Counting it shifts every later line number by one.
    if (raw.startsWith('\\')) continue;

    const marker = raw[0] ?? ' ';
    const content = raw.slice(1);

    if (marker === '+') {
      current.lines.push({ kind: 'add', oldLine: null, newLine, content });
      newLine++;
    } else if (marker === '-') {
      current.lines.push({ kind: 'del', oldLine, newLine: null, content });
      oldLine++;
    } else {
      // A space marker, or a completely empty string (some producers emit '' for
      // a blank context line rather than a lone space). Both are context.
      current.lines.push({ kind: 'context', oldLine, newLine, content });
      oldLine++;
      newLine++;
    }
  }

  return hunks;
}

/**
 * Render a file's hunks with the NEW-file line number in a left gutter.
 *
 * This exists for the prompt, and it's the single highest-leverage thing we do
 * for step 18. Models are unreliable at COUNTING diff offsets and very reliable
 * at COPYING a number printed beside the text — so we print it, and tell the
 * model to cite a number from the gutter. Deleted lines get no number, which
 * makes them impossible to cite by accident rather than merely forbidden.
 *
 * The hunk header stays in: its trailing text is usually the enclosing function
 * signature, which is free context the model would otherwise lack.
 */
function renderNumbered(hunks: Hunk[]): string {
  const blocks = hunks.map((hunk) => {
    const body = hunk.lines.map((line) => {
      const gutter = line.newLine === null ? '      ' : String(line.newLine).padStart(6);
      const marker = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';
      return `${gutter} │ ${marker} ${line.content}`;
    });
    return [hunk.header, ...body].join('\n');
  });

  return blocks.join('\n');
}

/**
 * Everything downstream needs to know about one reviewable file.
 *
 * DECISION — commentable = ADDED lines only. GitHub would also accept context
 * lines inside a hunk, but restricting to '+' keeps the bot commenting on what
 * the author actually wrote in this PR, and it's the strictest option, so it
 * cannot 422. Widening later is one line: include 'context' in the filter.
 */
export function chunkFile(file: ChangedFile): FileChunk {
  // Defensive: filterFiles already drops patch-less files, so this should never
  // fire — but an empty chunk is a safe answer, and a crash here would take out
  // the whole run.
  const hunks = file.patch ? parsePatch(file.patch) : [];

  const commentableLines = hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.kind === 'add' && line.newLine !== null)
    .map((line) => line.newLine as number);

  return {
    filename: file.filename,
    hunks,
    commentableLines,
    numbered: renderNumbered(hunks),
  };
}

/** Is this line legal to anchor an inline comment to? */
export function isCommentableLine(chunk: FileChunk, line: number): boolean {
  return chunk.commentableLines.includes(line);
}

/**
 * Rescue a finding whose line is slightly off — the LLM cites line 41 when the
 * change is on 42. Returns the closest commentable line within `maxDistance`,
 * or null if the finding is too far off to trust.
 *
 * Deliberately narrow: a big window would relocate a comment onto unrelated
 * code, which is worse than not posting it. Callers demote a null to a summary
 * bullet rather than dropping it (PROJECT_PLAN §7 #5 — fail soft).
 */
export function nearestCommentableLine(
  chunk: FileChunk,
  line: number,
  maxDistance = 3,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;

  for (const candidate of chunk.commentableLines) {
    const distance = Math.abs(candidate - line);
    if (distance < bestDistance || (distance === bestDistance && candidate < (best ?? Infinity))) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return bestDistance <= maxDistance ? best : null;
}

/** The minimum a thing needs to be anchorable: a file and a line. */
export type Anchorable = { path: string; line: number };

/**
 * Validate findings against the line map, snapping near misses and separating
 * out the ones that can't be anchored at all.
 *
 * Generic over `T` rather than typed to `Finding` on purpose: it keeps this
 * module free of any import from state.ts, so there's no import cycle
 * (state.ts already imports FileChunk from here).
 *
 * WHERE THIS RUNS MATTERS. It belongs in `aggregate`, before Phase 5's
 * `interrupt()` — the draft a human approves must already be postable. Validate
 * in `post` instead and you'd be asking someone to approve comments that then
 * silently vanish.
 */
export function anchorAll<T extends Anchorable>(
  items: T[],
  chunks: FileChunk[],
): { anchored: T[]; unanchored: T[] } {
  const byPath = new Map(chunks.map((chunk) => [chunk.filename, chunk]));
  const anchored: T[] = [];
  const unanchored: T[] = [];

  for (const item of items) {
    const chunk = byPath.get(item.path);

    // A path we never chunked — the model invented a filename, or named a file
    // the filters excluded. Nothing to snap to.
    if (!chunk) {
      unanchored.push(item);
      continue;
    }

    if (isCommentableLine(chunk, item.line)) {
      anchored.push(item);
      continue;
    }

    const snapped = nearestCommentableLine(chunk, item.line);
    if (snapped === null) {
      unanchored.push(item);
      continue;
    }

    anchored.push({ ...item, line: snapped });
  }

  return { anchored, unanchored };
}
