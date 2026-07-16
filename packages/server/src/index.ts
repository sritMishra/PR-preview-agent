import 'dotenv/config';

import express from 'express';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(express.json());

// Liveness probe — lets us confirm the server boots before any real logic exists.
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
