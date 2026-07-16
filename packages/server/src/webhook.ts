import { Webhooks } from '@octokit/webhooks';

// Fail fast if the shared secret is missing — without it we cannot verify that
// incoming payloads actually came from GitHub, so there's no point starting.
const secret = process.env.GITHUB_WEBHOOK_SECRET;
if (!secret) {
  throw new Error('GITHUB_WEBHOOK_SECRET is not set (see .env / .env.example)');
}

// The Webhooks instance does two jobs:
//   1. Verifies the X-Hub-Signature-256 HMAC on every delivery (using `secret`).
//   2. Acts as an event emitter — we subscribe to event names with `.on(...)`.
// Deliveries that fail verification never reach our listeners.
export const webhooks = new Webhooks({ secret });

// Subscribe to *all* pull_request activity for now (opened, closed, edited…).
// We'll narrow to the actions we care about (opened/reopened/synchronize) and
// filter out drafts/bots in the next increment.
webhooks.on('pull_request', ({ id, name, payload }) => {
  const { action, number, pull_request: pr } = payload;
  console.log(
    `[webhook] verified ${name}.${action} — PR #${number} "${pr.title}" ` +
      `by ${pr.user?.login} (delivery ${id})`,
  );
});

// A catch-all so we can see anything else GitHub sends during development.
webhooks.onAny(({ id, name }) => {
  console.log(`[webhook] received event "${name}" (delivery ${id})`);
});
