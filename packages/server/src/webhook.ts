import { Webhooks } from '@octokit/webhooks';

import { config } from './config.js';

// The Webhooks instance does two jobs:
//   1. Verifies the X-Hub-Signature-256 HMAC on every delivery (using the secret).
//   2. Acts as an event emitter — we subscribe to event names with `.on(...)`.
// Deliveries that fail verification never reach our listeners. The secret is
// already validated as present by config.ts, so no local check is needed here.
export const webhooks = new Webhooks({ secret: config.githubWebhookSecret });

// Subscribe only to the PR actions that change code and are worth reviewing.
// Subscribing to action-specific event names IS our "which actions" filter —
// GitHub fires pull_request for many actions (labeled, edited, assigned…) that
// we simply never register for, so they never reach this handler.
webhooks.on(
  ['pull_request.opened', 'pull_request.reopened', 'pull_request.synchronize'],
  ({ name, payload }) => {
    const { action, number, pull_request: pr } = payload;
    const author = pr.user?.login ?? 'unknown';

    // Guard 1: skip draft PRs — explicitly "not ready", reviewing is premature.
    if (pr.draft) {
      console.log(`[webhook] skip PR #${number}: draft`);
      return;
    }

    // Guard 2 (anti-loop): skip PRs opened by bots — including our own bot and
    // things like Dependabot. Without this, automated PRs could trigger
    // automated reviews in a cycle. See PROJECT_PLAN §7 principle #3.
    if (pr.user?.type === 'Bot') {
      console.log(`[webhook] skip PR #${number}: bot author (${author})`);
      return;
    }

    console.log(
      `[webhook] will review ${name}.${action} — PR #${number} "${pr.title}" by ${author}`,
    );
  },
);
