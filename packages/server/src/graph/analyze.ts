import { z } from 'zod';

import { getReviewModel } from '../llm.js';

import { SYSTEM_PROMPT, buildUserPrompt, type PromptInput } from './prompts.js';
import type { Finding } from './state.js';

/**
 * One review call: a file's diff in, structured findings out.
 *
 * THE IDEA — STRUCTURED OUTPUT. The naive approach is to ask for prose and parse
 * it: the model says "around line 203, this mutates the cart" and you write a
 * regex. That breaks the first time it phrases things differently.
 *
 * Instead we hand the model a SCHEMA. LangChain converts it to JSON Schema and
 * presents it as a tool the model is required to call, so the model literally
 * cannot answer in free prose — what comes back is validated data, or the call
 * is retried. The parsing problem stops existing.
 */

const ModelFinding = z.object({
  // .describe() is not a comment — it becomes the field's description in the
  // JSON Schema the model actually reads. These strings are prompt, and they're
  // the most reliable place to put per-field rules, because they sit right next
  // to the field being filled in.
  line: z
    .number()
    .int()
    .describe(
      'The line number this comment attaches to. MUST be one of the commentable ' +
        'lines listed in the message, and must appear in the diff gutter on a "+" line.',
    ),
  severity: z
    .enum(['low', 'medium', 'high'])
    .describe('high: likely wrong behaviour, data loss or a security hole. low: worth a mention.'),
  category: z
    .enum(['correctness', 'security', 'performance', 'tests', 'readability'])
    .describe('Which kind of problem this is.'),
  body: z
    .string()
    .describe(
      'The review comment: 1-3 sentences saying what is wrong and what to do about it. ' +
        'Written to the PR author, so no preamble and no restating the diff.',
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'How sure you are this is a real problem given you can only see this diff. ' +
        'Be honest — low-confidence findings are filtered out, so a hedge is free ' +
        'while an inflated score is not.',
    ),
});

/**
 * Note the model returns findings WITHOUT a `path`. The branch making the call
 * already knows which file it handed over — asking the model to repeat it back
 * would just be one more field it can get wrong. We stamp the path on below.
 */
export const ModelOutput = z.object({
  findings: z
    .array(ModelFinding)
    .max(5)
    .describe(
      'Problems worth a human reviewer’s attention, most important first. ' +
        'Return an empty array if there are none — that is a valid, useful answer.',
    ),
});

export type ModelOutputType = z.infer<typeof ModelOutput>;

/**
 * Review one file.
 *
 * Deliberately NOT a graph node: it takes a plain input and returns findings,
 * with no knowledge of state or LangGraph. 18c wraps it in a node and fans it
 * out; until then it can be driven by hand from verify-analyze.ts.
 *
 * Throws on API failure. That's correct here — the caller decides the policy,
 * and in 18c the fan-out branch will catch it and append to `errors` so one
 * file's failure doesn't sink the run (§7 #5).
 */
export async function reviewFile(input: PromptInput): Promise<Finding[]> {
  // `method: 'jsonSchema'` is doing real work here — the default is not this.
  //
  // LangChain's DEFAULT ('functionCalling') implements structured output as a
  // FORCED tool call. Anthropic rejects forced tool choice while thinking is
  // enabled, so with our adaptive thinking LangChain silently downgrades to an
  // UNFORCED tool call — the model is merely invited to use the tool — and warns
  // that it will throw if the model answers in prose instead. That's a real
  // reliability hole, and it's exactly the sort that shows up once in fifty runs.
  //
  // 'jsonSchema' takes a different route entirely: Anthropic's native structured
  // outputs (`output_config.format`), which constrains decoding directly rather
  // than routing through a tool. No tool call, so nothing to force, so thinking
  // and guaranteed-shaped output stop being in tension.
  //
  // (`name` is a functionCalling-only option and is ignored on this path, so it
  // is deliberately not passed.)
  const model = getReviewModel().withStructuredOutput(ModelOutput, {
    method: 'jsonSchema',
  });

  const result = await model.invoke([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(input) },
  ]);

  console.log("[MY CONSOLE]: Model Output:", result)

  // Stamp on the one field the model was never asked for. After this the shape
  // is exactly the `Finding` the pipeline has carried since Phase 3 — which is
  // why nothing downstream needs to change.
  //
  // No filtering and no line validation here: `aggregate` owns both, so that the
  // draft a human approves in Phase 5 is the same draft that gets posted.
  return result.findings.map((f) => ({
    path: input.chunk.filename,
    line: f.line,
    severity: f.severity,
    category: f.category,
    body: f.body,
    confidence: f.confidence,
  }));
}
