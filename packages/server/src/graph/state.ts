import { Annotation } from '@langchain/langgraph';

import type { ChangedFile } from '../github/pr.js';

import type { FileChunk } from './chunks.js';
import type { SkippedFile } from './filters.js';

// One thing the reviewer wants to say about one line of code.
// Phase 3 fabricates these by hand; Phase 4 has the LLM produce them under a
// Zod schema (structured output), which is why the shape is already this
// specific — it has to be postable as an inline comment without translation.
export type Finding = {
  path: string;
  line: number;
  severity: 'low' | 'medium' | 'high';
  category: 'correctness' | 'security' | 'performance' | 'tests' | 'readability';
  body: string;
  // How sure the model was (0-1). Optional because the Phase 3 stub doesn't set
  // it. Carried rather than acted on here: `aggregate` decides the threshold
  // (PROJECT_PLAN step 19), so dropping it at the source would take the choice
  // away from the node that owns ranking.
  confidence?: number;
};

/**
 * The single object that flows through every node of the review graph.
 *
 * `Annotation.Root({...})` declares the state's fields ("channels"). Each field
 * says how updates to it are merged:
 *
 *   Annotation<T>              → last write wins (no parens — this is TypeScript's
 *                                "instantiation expression", not a function call)
 *   Annotation<T>({reducer,…}) → custom merge behaviour
 */
export const ReviewState = Annotation.Root({
  // ── Inputs: set once when the run starts, never changed by a node. ──
  installationId: Annotation<number>,
  owner: Annotation<string>,
  repo: Annotation<string>,
  prNumber: Annotation<number>,

  // ── Filled by `ingest`. Last-write-wins is correct: one node, one writer. ──
  diff: Annotation<string>,
  files: Annotation<ChangedFile[]>,

  // ── Filled by `filterAndChunk`. ──
  // Single writer, written once per run → last-write-wins is correct. (Contrast
  // with `findings` below, which needs `concat` precisely because Phase 4's
  // `analyze` step will have many parallel writers.)
  //
  // `files` is everything GitHub told us changed; `reviewableFiles` is the
  // subset we'll actually spend tokens on. Keeping BOTH is what lets the summary
  // honestly say "I looked at 4 of 9 files" — and `skippedFiles` says why.
  reviewableFiles: Annotation<ChangedFile[]>,
  skippedFiles: Annotation<SkippedFile[]>,

  // The parsed diff: per file, its hunks and the right-side line numbers an
  // inline comment may anchor to. Step 18's fan-out sends ONE of these per
  // branch, which is why it has to be plain JSON — see FileChunk's note on why
  // `commentableLines` is an array rather than a Set.
  chunks: Annotation<FileChunk[]>,

  // ── Findings ACCUMULATE. ──
  // In Phase 4 several analyze branches run in parallel and each returns its own
  // findings; with last-write-wins the slowest branch would erase the others.
  // concat merges them instead. `default` supplies the [] that the first
  // .concat needs — without it the first write would be `undefined.concat(...)`.
  findings: Annotation<Finding[]>({
    reducer: (existing, incoming) => existing.concat(incoming),
    default: () => [],
  }),

  // ── Filled by `aggregate` / `post`. ──
  summary: Annotation<string>,
  postedReviewUrl: Annotation<string>,

  // ── Errors accumulate too, for the same reason: a node that fails appends
  // its complaint and the run continues with partial results, rather than
  // throwing away everything the other nodes produced (plan §7, principle #5).
  errors: Annotation<string[]>({
    reducer: (existing, incoming) => existing.concat(incoming),
    default: () => [],
  }),
});

// The plain TypeScript type of the state object, derived from the annotation
// above. Node functions will be typed with this, so a typo in a field name is a
// compile error rather than a silent no-op at runtime.
export type ReviewStateType = typeof ReviewState.State;
