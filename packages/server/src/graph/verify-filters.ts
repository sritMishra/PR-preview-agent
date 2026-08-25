// Standalone FILTER check — NOT part of the running server.
//
// Run it with:  npx tsx src/graph/verify-filters.ts   (from packages/server/)
//
// Pure functions only: no network, no GitHub, no API key, not even .env.
import type { ChangedFile } from '../github/pr.js';

import { filterFiles, skipReasonFor } from './filters.js';

// Minimal factory so each case below shows only what it's testing.
function file(partial: Partial<ChangedFile> & { filename: string }): ChangedFile {
  return {
    status: 'modified',
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: '@@ -1 +1 @@\n-old\n+new',
    ...partial,
  };
}

const cases: Array<[ChangedFile, ReturnType<typeof skipReasonFor>]> = [
  [file({ filename: 'src/index.ts' }), null],
  [file({ filename: 'src/distance.ts' }), null], // contains "dist" but isn't in dist/
  [file({ filename: 'README.md' }), null],
  [file({ filename: 'src/old.ts', status: 'removed' }), 'deleted'],
  [file({ filename: 'logo.png', patch: undefined }), 'no-patch'],
  [file({ filename: 'package-lock.json' }), 'generated'],
  [file({ filename: 'dist/bundle.js' }), 'generated'],
  [file({ filename: 'web/vendor/jquery.js' }), 'generated'],
  [file({ filename: 'app.min.js' }), 'generated'],
  [file({ filename: 'src/huge.ts', changes: 5000 }), 'file-too-large'],
];

let failures = 0;
for (const [input, expected] of cases) {
  const actual = skipReasonFor(input);
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${input.filename.padEnd(24)} → ${actual ?? 'review'}`);
}

// Budget check: 25 individually-fine files, but MAX_FILES_REVIEWED is 20.
const many = Array.from({ length: 25 }, (_, i) => file({ filename: `src/f${i}.ts` }));
const result = filterFiles(many);
const budgetOk = result.reviewable.length === 20 && result.skipped.length === 5;
if (!budgetOk) failures++;
console.log(
  `${budgetOk ? '✅' : '❌'} file budget: ${result.reviewable.length} kept, ${result.skipped.length} skipped`,
);

console.log(failures === 0 ? '\nAll filter cases pass.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
