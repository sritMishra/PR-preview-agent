// Standalone read check — NOT part of the running server.
//
// Run it with:  npx tsx src/github/verify-read.ts   (from packages/server/)
//
// It authenticates as the installation, finds the first OPEN pull request on
// the test repo, and prints what our three read functions return. Proves the
// room-key token can actually read PR data before we wire anything up.
import { getInstallationOctokit } from './app.js';
import {
  fetchChangedFiles,
  fetchExistingReviewComments,
  fetchPullRequestDiff,
} from './pr.js';

// Hardcoded for this dev script only. At runtime these come from the webhook
// payload — nothing here is hardcoded in the real server.
const INSTALLATION_ID = 147408011; // from verify-auth.ts
const OWNER = 'sritMishra';
const REPO = 'PR-preview-agent';

const octokit = getInstallationOctokit(INSTALLATION_ID);

// Find a PR to read against — the newest open one.
const { data: openPRs } = await octokit.rest.pulls.list({
  owner: OWNER,
  repo: REPO,
  state: 'open',
  per_page: 1,
});

if (openPRs.length === 0) {
  console.log(
    `No open PRs on ${OWNER}/${REPO}. Open one (any small change) and re-run.`,
  );
  process.exit(0);
}

const prNumber = openPRs[0].number;
const ctx = { owner: OWNER, repo: REPO, prNumber };
console.log(`Reading PR #${prNumber}: "${openPRs[0].title}"\n`);

// 1. The raw diff.
const diff = await fetchPullRequestDiff(octokit, ctx);
console.log(`--- diff (${diff.split('\n').length} lines) — first 20: ---`);
console.log(diff.split('\n').slice(0, 20).join('\n'));

// 2. Changed files.
const files = await fetchChangedFiles(octokit, ctx);
console.log(`\n--- changed files (${files.length}) ---`);
for (const f of files) {
  console.log(`  ${f.status.padEnd(9)} +${f.additions} -${f.deletions}  ${f.filename}`);
}

// 3. Existing inline comments.
const comments = await fetchExistingReviewComments(octokit, ctx);
console.log(`\n--- existing inline comments (${comments.length}) ---`);
for (const c of comments) {
  console.log(`  ${c.author} on ${c.path}:${c.line ?? '?'} — ${c.body.slice(0, 60)}`);
}
