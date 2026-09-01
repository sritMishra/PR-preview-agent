// Standalone PROMPT PREVIEW — NOT part of the running server.
//
// Run it with:  npx tsx src/graph/verify-prompt.ts   (from packages/server/)
//               — or from anywhere; unlike the other verify-* scripts this one
//                 never loads config.ts, so the working directory is irrelevant.
//
// Prints exactly what the model will be asked in step 18b. No .env, no API key,
// no GitHub App, no network, no tokens spent. This is the answer to "what did the model actually see?"
// — a question you will ask constantly once tuning starts, and one that should
// never require guesswork.
import type { ChangedFile } from '../github/pr.js';

import { chunkFile } from './chunks.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts.js';

const patch = (...lines: string[]) => lines.join('\n');

// The applyDiscount example: one line removed, five added in its place. Two of
// the bugs here are visible entirely WITHIN the hunk (line 201 guards
// `discount` while 204 returns `rounded`; line 203 mutates the caller's data),
// and one is not (does lookupRate return 0.2 or 20?). Good material for judging
// whether the prompt produces useful findings.
const cart: ChangedFile = {
  filename: 'packages/server/src/cart.ts',
  status: 'modified',
  additions: 5,
  deletions: 1,
  changes: 6,
  patch: patch(
    '@@ -197,5 +197,9 @@ export function applyDiscount(cart: Cart, code: string) {',
    '   const rate = lookupRate(code);',
    '   if (!rate) return cart.total;',
    ' ',
    '-  return cart.total * (1 - rate);',
    '+  const discount = cart.total * rate;',
    '+  if (discount > cart.total) return 0;',
    '+  const rounded = Math.round(discount * 100) / 100;',
    '+  cart.items.forEach((i) => (i.price -= rate));',
    '+  return cart.total - rounded;',
    ' }',
  ),
};

const chunk = chunkFile(cart);
const userPrompt = buildUserPrompt({
  chunk,
  fileIndex: 1,
  fileCount: 3,
  otherFiles: ['packages/server/src/checkout.ts', 'packages/server/src/payment.ts'],
  prTitle: 'Fix discount rounding on cart totals',
});

const rule = (label: string) => `\n${'═'.repeat(78)}\n  ${label}\n${'═'.repeat(78)}\n`;

console.log(rule('SYSTEM PROMPT  (constant — same on every call)'));
console.log(SYSTEM_PROMPT);

console.log(rule('USER PROMPT  (built per file)'));
console.log(userPrompt);

// Rough size check. ~4 characters per token is a decent English/code estimate —
// good enough to notice if a prompt balloons, not a billing figure.
const chars = SYSTEM_PROMPT.length + userPrompt.length;
console.log(rule('SIZE'));
console.log(`  characters       ${chars}`);
console.log(`  rough tokens     ~${Math.round(chars / 4)}   (system is reused; only the user half scales with the PR)`);
console.log(`  commentable      ${chunk.commentableLines.join(', ')}`);
console.log('');
