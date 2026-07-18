import { createNodeMiddleware } from '@octokit/webhooks';
import express from 'express';

// Import config FIRST — it loads .env and validates the environment before any
// other module reads configuration.
import { config } from './config.js';
import { webhooks } from './webhook.js';

const app = express();

// IMPORTANT: mount the webhook middleware BEFORE express.json().
// GitHub signs the RAW request body; this middleware reads those raw bytes,
// verifies the HMAC signature, and dispatches to our webhook listeners. If
// express.json() ran first it would consume the body and break verification.
// The middleware handles POST /webhook itself; every other route falls through.
app.use(createNodeMiddleware(webhooks, { path: '/webhook' }));

app.use(express.json());

// Liveness probe — lets us confirm the server boots before any real logic exists.
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});
