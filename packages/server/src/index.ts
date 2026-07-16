import 'dotenv/config';

import { createNodeMiddleware } from '@octokit/webhooks';
import express from 'express';

import { webhooks } from './webhook.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

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

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
