import { ChatAnthropic } from '@langchain/anthropic';

import { config } from './config.js';

/**
 * The review model client.
 *
 * One module, one place where model configuration lives — so tuning latency,
 * cost, or model choice never means touching graph code.
 */

let cached: ChatAnthropic | undefined;

/**
 * Build (once) the chat model the review nodes use.
 *
 * Lazily constructed rather than created at import time: the server must still
 * boot for webhook and graph work when no API key is configured. The failure
 * happens here, loudly, with a message that says what to do — not as an
 * `undefined` deep inside a fan-out branch.
 */
export function getReviewModel(): ChatAnthropic {
  if (cached) return cached;

  if (!config.anthropicApiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set — the review model cannot be created. ' +
        'Add it to packages/server/.env (see .env.example).',
    );
  }

  cached = new ChatAnthropic({
    apiKey: config.anthropicApiKey,
    model: config.anthropicModel,

    // Generous, and deliberately not lowballed: with adaptive thinking on, the
    // model's reasoning tokens count against this ceiling too. Hitting the cap
    // truncates mid-structure and wastes the whole call.
    maxTokens: 16000,

    // NOT the default — and this line matters more than it looks.
    //
    // @langchain/anthropic ships `thinking: { type: 'disabled' }` as its
    // default. On Claude Opus 5 with thinking disabled, the model sometimes
    // writes a tool call into its VISIBLE TEXT instead of emitting a real
    // tool-use block. Structured output IS tool calling underneath, so that
    // default would make `withStructuredOutput` fail intermittently and
    // silently. 'adaptive' lets the model decide how much to think per file —
    // which is what we want anyway, since a one-line diff and a subtle
    // concurrency bug do not deserve the same effort.
    thinking: { type: 'adaptive' },

    // NOTE: no `temperature`. Sampling parameters were removed on Opus 5 and
    // sending one is a 400. Leaving it unset is correct, not an oversight.

    maxRetries: 2,
  });

  return cached;
}
