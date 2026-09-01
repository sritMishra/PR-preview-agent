// Standalone ANALYZE check — NOT part of the running server.
//
// Run it with:  npx tsx src/graph/verify-analyze.ts   (from packages/server/)
//
// ⚠️ This one SPENDS MONEY: it makes a real API call. It posts nothing to
// GitHub and needs no App credentials — but it does need ANTHROPIC_API_KEY.
import { config } from '../config.js';
import type { ChangedFile } from '../github/pr.js';

import { reviewFile } from './analyze.js';
import { anchorAll, chunkFile } from './chunks.js';

const patch = (...lines: string[]) => lines.join('\n');

// The same fixture verify-prompt.ts previews, so you can read the prompt and
// the answer to it side by side.
//
// KNOWN ANSWERS — judge the model against these:
//   visible in the diff  · line 203 mutates the caller's cart items in place
//   visible in the diff  · line 201 guards `discount` but 204 returns `rounded`
//   NOT visible          · does lookupRate return 0.2 or 20? A good answer
//                          HEDGES here rather than asserting — that's the
//                          "what you cannot see" instruction doing its job.
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

console.log(`model            ${config.anthropicModel}`);
console.log(`file             ${chunk.filename}`);
console.log(`commentable      ${chunk.commentableLines.join(', ')}`);
console.log('\ncalling the model…\n');

const startedAt = process.hrtime.bigint();
const findings = await reviewFile({
  chunk,
  fileIndex: 1,
  fileCount: 3,
  otherFiles: ['packages/server/src/checkout.ts', 'packages/server/src/payment.ts'],
  prTitle: 'Fix discount rounding on cart totals',
});

const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

console.log(`${findings.length} finding(s) in ${seconds.toFixed(1)}s\n`);

for (const f of findings) {
  const confidence = f.confidence === undefined ? '—' : f.confidence.toFixed(2);
  const legal = chunk.commentableLines.includes(f.line) ? '' : '  ⚠️ NOT a commentable line';
  console.log(`  line ${String(f.line).padEnd(5)} ${f.category}/${f.severity}  conf ${confidence}${legal}`);
  console.log(`    ${f.body.replace(/\n/g, '\n    ')}\n`);
}

// The gate, run for real. Today this is where a hallucinated line number gets
// caught — the first time it has had anything to actually catch.
const { anchored, unanchored } = anchorAll(findings, [chunk]);
console.log('── anchoring ──');
console.log(`  ${anchored.length} would post inline, ${unanchored.length} would be demoted to the summary`);
for (const a of anchored) {
  const original = findings.find((f) => f.body === a.body);
  if (original && original.line !== a.line) {
    console.log(`  ↔ snapped ${original.line} → ${a.line}`);
  }
}
for (const u of unanchored) {
  console.log(`  ⤓ demoted (line ${u.line} not in the diff)`);
}
console.log('');
