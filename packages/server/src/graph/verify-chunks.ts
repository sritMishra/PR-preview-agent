// Standalone DIFF PARSER check — NOT part of the running server.
//
// Run it with:  npx tsx src/graph/verify-chunks.ts   (from packages/server/)
//
// Pure functions only: no network, no GitHub, no API key, not even .env.
import { chunkFile, nearestCommentableLine, parsePatch } from './chunks.js';

// Fixtures are arrays of lines joined with '\n' rather than template literals,
// so leading spaces (which ARE the context marker in a unified diff) can't be
// lost to reformatting — and so '\\ No newline' survives as a real backslash.
const patch = (...lines: string[]) => lines.join('\n');

const NORMAL = patch(
  '@@ -12,6 +12,7 @@ export function login(user) {',
  ' const token = sign(user);',
  '-return token;',
  "+if (!token) throw new Error('sign failed');",
  '+return token;',
  ' }',
);

// Counts omitted — unified diff drops them when they're 1. The classic bug.
const OMITTED_COUNTS = patch('@@ -1 +1 @@', '-old', '+new');

// A brand-new file: nothing on the old side at all.
const NEW_FILE = patch('@@ -0,0 +1,3 @@', '+a', '+b', '+c');

// Two hunks — the second must restart its counter at ITS OWN header, not
// continue from where the first left off.
const TWO_HUNKS = patch(
  '@@ -1,2 +1,3 @@',
  ' a',
  '+b',
  ' c',
  '@@ -10,2 +11,3 @@',
  ' x',
  '+y',
  ' z',
);

// '\ No newline at end of file' annotates the previous line. Counting it as a
// line shifts every number after it — here it would report 3 instead of 2.
const NO_NEWLINE = patch(
  '@@ -1,2 +1,2 @@',
  ' a',
  '-b',
  '\\ No newline at end of file',
  '+b2',
  '\\ No newline at end of file',
);

const cases: Array<[string, string, number[]]> = [
  ['normal hunk', NORMAL, [13, 14]],
  ['omitted counts', OMITTED_COUNTS, [1]],
  ['new file', NEW_FILE, [1, 2, 3]],
  ['two hunks', TWO_HUNKS, [2, 12]],
  ['no-newline marker', NO_NEWLINE, [2]],
];

let failures = 0;
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${label.padEnd(22)} ${detail}`);
};

for (const [label, text, expected] of cases) {
  const chunk = chunkFile({
    filename: 'src/example.ts',
    status: 'modified',
    additions: 0,
    deletions: 0,
    changes: 0,
    patch: text,
  });
  const actual = chunk.commentableLines;
  check(
    label,
    JSON.stringify(actual) === JSON.stringify(expected),
    `commentable → [${actual.join(', ')}]  (expected [${expected.join(', ')}])`,
  );
}

// Hunk metadata: the omitted counts must default to 1, not NaN or 0.
const [omitted] = parsePatch(OMITTED_COUNTS);
check(
  'omitted counts → 1',
  omitted?.oldLines === 1 && omitted?.newLines === 1,
  `oldLines=${omitted?.oldLines} newLines=${omitted?.newLines}`,
);

// Snapping: rescue near misses, refuse far ones.
const normalChunk = chunkFile({
  filename: 'src/example.ts',
  status: 'modified',
  additions: 0,
  deletions: 0,
  changes: 0,
  patch: NORMAL,
});
check('snap 12 → 13', nearestCommentableLine(normalChunk, 12) === 13, 'within 3 lines');
check('snap 14 → 14', nearestCommentableLine(normalChunk, 14) === 14, 'already valid');
check('snap 40 → null', nearestCommentableLine(normalChunk, 40) === null, 'too far, demote');

console.log('\n── prompt rendering (what step 18 will show the model) ──');
console.log(normalChunk.numbered);

console.log(failures === 0 ? '\nAll chunk cases pass.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
