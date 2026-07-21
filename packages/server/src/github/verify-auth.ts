// Standalone auth check — NOT part of the running server.
//
// Run it with:  npx tsx src/github/verify-auth.ts   (from packages/server/)
//
// It authenticates as the App (JWT only) and asks GitHub to list the App's
// installations. If this prints your installation, the whole token dance —
// private key → signed JWT → GitHub accepting it — is working end to end.
import { getAppOctokit } from './app.js';

const octokit = getAppOctokit();

// App-level endpoint: "which accounts have installed me?" This is exactly the
// kind of call the JWT/ID-badge level is allowed to make.
const { data: installations } = await octokit.rest.apps.listInstallations();

console.log(`✅ Auth works. Found ${installations.length} installation(s):`);
for (const inst of installations) {
  // `account` is the org/user that installed the App. `repository_selection`
  // is 'all' or 'selected' depending on how you scoped the install.
  const account =
    inst.account && 'login' in inst.account ? inst.account.login : '(unknown)';
  console.log(
    `  • installation id=${inst.id}  account=${account}  repos=${inst.repository_selection}`,
  );
}
