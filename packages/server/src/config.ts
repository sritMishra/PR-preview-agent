// Single source of truth for environment configuration.
//
// Loading .env here (as this module's FIRST import) means any file that imports
// `config` automatically gets the env loaded first — no need to remember a
// separate `import 'dotenv/config'` at the entry point. dotenv reads .env from
// the current working directory, which for this package is packages/server/.
import 'dotenv/config';

import { z } from 'zod';

// The schema describes every variable the server understands. We validate ONCE
// at startup so a misconfiguration fails immediately with a clear message —
// instead of surfacing as a confusing `undefined` deep inside a request later.
//
// Rule of thumb: mark a var required only once a shipped feature actually needs
// it. Vars for future phases stay optional so the server can boot today.
const envSchema = z.object({
  // Phase 1 — needed now to verify webhook signatures.
  GITHUB_WEBHOOK_SECRET: z.string().min(1, 'required to verify GitHub webhooks'),

  // Server port. Env values are strings, so coerce to a number; default 3000.
  PORT: z.coerce.number().int().positive().default(3000),

  // Later phases — optional for now; we'll make each required in its phase.
  GITHUB_APP_ID: z.string().optional(), // Phase 2 (GitHub App auth)
  GITHUB_PRIVATE_KEY: z.string().optional(), // Phase 2
  ANTHROPIC_API_KEY: z.string().optional(), // Phase 4 (the review model)
  DATABASE_URL: z.string().optional(), // Phase 3 (checkpointer + Prisma)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration (see packages/server/.env.example):');
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  }
  // Exit rather than throw: this is a fatal startup problem, and exit(1) gives a
  // clean "the process refused to start" signal without a scary stack trace.
  process.exit(1);
}

// Re-expose the validated values under tidy camelCase names. Everything here is
// fully typed — e.g. `config.port` is `number`, not `string | undefined`.
export const config = {
  githubWebhookSecret: parsed.data.GITHUB_WEBHOOK_SECRET,
  port: parsed.data.PORT,
  githubAppId: parsed.data.GITHUB_APP_ID,
  githubPrivateKey: parsed.data.GITHUB_PRIVATE_KEY,
  anthropicApiKey: parsed.data.ANTHROPIC_API_KEY,
  databaseUrl: parsed.data.DATABASE_URL,
} as const;
