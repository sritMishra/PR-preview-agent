import type { ChangedFile } from '../github/pr.js';

// ── Budgets ──
// Deliberately conservative. A review that says something useful about 15 files
// beats one that says something forgettable about 60 (PROJECT_PLAN §7 #2).
export const MAX_FILES_REVIEWED = 20;
export const MAX_CHANGES_PER_FILE = 600;
export const MAX_TOTAL_CHANGES = 3000;

// Machine-authored files: a human didn't write these, so there's no decision
// to critique. Matched on the BASENAME.
const LOCKFILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'composer.lock',
  'go.sum',
]);

// Any path containing one of these SEGMENTS is generated or vendored.
// Matched segment-wise, not as a substring — so `src/distance.ts` survives
// even though it contains the letters "dist".
const NOISY_DIR_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'vendor',
  'coverage',
  '.next',
  '__snapshots__',
  '__generated__',
  'migrations',
]);

// Filename suffixes that mark generated output.
const NOISY_SUFFIXES = [
  '.min.js',
  '.min.css',
  '.map',
  '.snap',
  '.generated.ts',
  '.gen.go',
  '.pb.go',
  '_pb2.py',
  '.lock',
];

// Every way a file can be excluded. A union of string literals rather than
// free-text so the summary can group by reason and TypeScript catches typos.
export type SkipReason =
  | 'deleted'
  | 'no-patch'
  | 'generated'
  | 'file-too-large'
  | 'file-budget-exhausted'
  | 'line-budget-exhausted';

export type SkippedFile = {
  filename: string;
  reason: SkipReason;
};

/**
 * Should we review this file at all? 
 * Returns null => means file can be reviewed it , else if returns a reason , then skip review
 * Pure — no I/O, no state — so it's trivially testable.
 *
 * Order matters: cheapest and most definitive checks first.
 */
export function skipReasonFor(file: ChangedFile): SkipReason | null {
  // Nothing left to comment on, and GitHub can't anchor a comment to it.
  if (file.status === 'removed') return 'deleted';

  // No patch means binary, OR a text file so large GitHub declined to send the
  // diff. Either way there's nothing for us to read — this one check quietly
  // handles images, fonts, PDFs and archives without an extension list.
  if (!file.patch) return 'no-patch';

  // GitHub always uses forward slashes, so no platform-specific path handling.
  const segments = file.filename.split('/');
  const basename = segments[segments.length - 1] ?? '';

  if (LOCKFILES.has(basename)) return 'generated';
  if (segments.some((segment) => NOISY_DIR_SEGMENTS.has(segment))) return 'generated';
  if (NOISY_SUFFIXES.some((suffix) => basename.endsWith(suffix))) return 'generated';

  // Reviewable in principle, not worth it in practice — usually a move or a
  // reformat, where the LLM burns tokens restating what the diff already shows.
  if (file.changes > MAX_CHANGES_PER_FILE) return 'file-too-large';

  return null;
}

export type FilterResult = {
  reviewable: ChangedFile[];
  skipped: SkippedFile[];
};

/**
 * Apply the per-file rules, then enforce the whole-PR budgets.
 *
 * The budgets are a second pass over what survived: even if every file is
 * individually fine, 80 of them is more than a useful review can cover.
 *
 * NOTE: budgets consume files in the order GitHub returned them (roughly
 * alphabetical), so an oversized PR keeps an arbitrary subset rather than the
 * most interesting one. Ranking by "likely to matter" is a Phase 6 refinement —
 * for now the skipped list makes the truncation visible rather than silent.
 */
export function filterFiles(files: ChangedFile[]): FilterResult {
  const reviewable: ChangedFile[] = [];
  const skipped: SkippedFile[] = [];
  let totalChanges = 0;

  for (const file of files) {
    const reason = skipReasonFor(file);
    if (reason) {
      skipped.push({ filename: file.filename, reason });
      continue;
    }

    if (reviewable.length >= MAX_FILES_REVIEWED) {
      skipped.push({ filename: file.filename, reason: 'file-budget-exhausted' });
      continue;
    }

    if (totalChanges + file.changes > MAX_TOTAL_CHANGES) {
      skipped.push({ filename: file.filename, reason: 'line-budget-exhausted' });
      continue;
    }

    reviewable.push(file);
    totalChanges += file.changes;
  }

  return { reviewable, skipped };
}
