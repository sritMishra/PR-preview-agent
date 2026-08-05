import { reviewGraph, threadIdFor } from './graph/graph.js';

// Everything needed to review one PR. The webhook builds this from the event
// payload and hands it over — the webhook never touches Octokit itself.
export type ReviewRequest = {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
};

/**
 * THE SEAM, now closed.
 *
 * Phase 2 did auth → read → post inline in this function. Phase 3 moved all of
 * it into the graph's nodes, so what's left here is an ADAPTER: it translates a
 * webhook event into a graph run and decides the thread identity. Note the
 * signature is unchanged — webhook.ts calls this exactly as it did before.
 */
export async function reviewPullRequest(req: ReviewRequest): Promise<void> {
  // One PR = one thread = one durable conversation with the checkpointer.
  const threadId = threadIdFor(req);

  console.log(`[review] starting graph run on thread ${threadId}`);

  // invoke(input, config):
  //   • `req` is the initial state — but as an UPDATE, not a whole state, so it
  //     merges through the same reducers a node's return value would. That's why
  //     ReviewRequest's four fields are exactly ReviewState's four input
  //     channels: nothing needs translating.
  //   • `thread_id` sits under `configurable` — LangChain's slot for runtime
  //     values the runnable itself reads (vs. top-level opts like timeouts).
  //   • the return value is the FINAL, fully-merged state after END.
  const finalState = await reviewGraph.invoke(req, {
    configurable: { thread_id: threadId },
  });

  console.log(
    `[review] thread ${threadId} done — ${finalState.findings.length} finding(s), ` +
      `${finalState.errors.length} error(s), review: ${finalState.postedReviewUrl}`,
  );
}
