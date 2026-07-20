// Standalone WRITE check — NOT part of the running server.
//
// Run it with:  npx tsx src/github/verify-post.ts   (from packages/server/)
//
// ⚠️ This POSTS a real (dummy) review to the newest open PR on the test repo.
// That's the Phase 2 milestone: the bot leaves a real comment under its name.
import { getInstallationOctokit } from './app.js';
import { fetchChangedFiles } from './pr.js';
import { postReview } from './review.js';

const INSTALLATION_ID = 147408011;
const OWNER = 'sritMishra';
const REPO = 'PR-preview-agent';

const octokit = getInstallationOctokit(INSTALLATION_ID);

const { data: openPRs } = await octokit.rest.pulls.list({
  owner: OWNER,
  repo: REPO,
  state: 'open',
  per_page: 1,
});

if (openPRs.length === 0) {
  console.log(`No open PRs on ${OWNER}/${REPO}. Open one and re-run.`);
  process.exit(0);
}

const prNumber = openPRs[0].number;
const ctx = { owner: OWNER, repo: REPO, prNumber };

// Find a real, comment-able line: the first ADDED line in the first file that
// has a patch. This is a throwaway version of the diff parsing we'll build
// properly in Phase 4 — just enough to pick a line GitHub will accept.
const files = await fetchChangedFiles(octokit, ctx);
let target: { path: string; line: number } | null = null;

for (const f of files) {
  if (!f.patch) continue; // binary/huge file — no hunk to anchor to
  let newLine = 0;
  for (const raw of f.patch.split('\n')) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      target = { path: f.filename, line: newLine }; // an added line — commentable
      break;
    }
    if (raw.startsWith('-')) continue; // deletion — new-file line not consumed
    newLine++; // context line
  }
  if (target) break;
}

if (!target) {
  console.log('No added lines found to anchor a comment on. Add a line and re-run.');
  process.exit(0);
}

console.log(`Posting review on PR #${prNumber}, anchored at ${target.path}:${target.line}...`);

const result = await postReview(octokit, ctx, {
  body: '👋 Dummy review from the PR review agent (Phase 2 plumbing test — not a real review yet).',
  event: 'COMMENT',
  comments: [
    {
      path: target.path,
      line: target.line,
      side: 'RIGHT',
      body: 'This is a hardcoded inline comment proving the write path works. Ignore me.',
    },
  ],
});

console.log(`✅ Posted review #${result.id}`);
console.log(`   ${result.htmlUrl}`);
