import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

import { config } from '../config.js';

// The App-level credentials, shared by every auth call below. These identify
// *which App* we are; the private key is what lets Octokit sign the JWT that
// proves it. Read once here so the rest of the file just references `appAuth`.
const appAuth = {
  appId: config.githubAppId,
  privateKey: config.githubPrivateKey,
} as const;

// `authStrategy: createAppAuth` tells Octokit: "don't expect a plain token —
// run the GitHub App token dance instead." Octokit then signs a short-lived
// JWT with the private key, exchanges it for tokens as needed, and caches +
// refreshes them automatically. We never touch a raw JWT or token ourselves.

/**
 * An Octokit authenticated as a specific INSTALLATION.
 *
 * This is the "room key": scoped to the repos + permissions granted when the
 * App was installed, so it can read diffs and post reviews. The `installationId`
 * comes straight off the webhook payload (`payload.installation.id`) — every PR
 * event tells us which installation to act as.
 */
export function getInstallationOctokit(installationId: number): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { ...appAuth, installationId },
  });
}

/**
 * An Octokit authenticated as the APP ITSELF (JWT only, no installation).
 *
 * This is the "ID badge": it proves our identity but is scoped to nothing in
 * particular, so it can only hit App-level endpoints like "list my
 * installations". It CANNOT read repo contents or post comments. We use it for
 * setup/verification — see verify-auth.ts.
 */
export function getAppOctokit(): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: appAuth,
  });
}
