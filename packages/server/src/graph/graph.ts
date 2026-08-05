import { END, MemorySaver, START, StateGraph } from '@langchain/langgraph';

import { aggregate, ingest, post } from './nodes.js';
import { ReviewState } from './state.js';

// The checkpointer IS the store, so it's created ONCE at module scope. A fresh
// MemorySaver per run would mean nothing was ever remembered.
//
// MemorySaver keeps checkpoints in a Map inside this process — they vanish on
// restart. PostgresSaver implements the identical interface, so swapping is a
// one-line change; we'll do it before Phase 5, where surviving a restart is the
// entire point.
const checkpointer = new MemorySaver();

/**
 * The review graph:  START → ingest → aggregate → post → END
 *
 * `new StateGraph(ReviewState)` starts an empty graph DESCRIPTION — it can't run
 * anything yet. Passing the annotation from state.ts is how it learns the
 * channels and their reducers. `.compile()` at the end turns the description
 * into something runnable.
 */
export const reviewGraph = new StateGraph(ReviewState)
  // ── Nodes first, then edges. ──
  // Each addNode teaches the builder a name, and TypeScript ACCUMULATES those
  // names into the graph's type. That's why order matters: addEdge can only
  // reference names already added, so a typo'd edge target is a compile error
  // rather than a runtime surprise. (Try changing 'aggregate' below to
  // 'agregate' and watch tsc catch it.)
  //
  // These strings are schema, not labels: checkpoints record progress BY node
  // name, so renaming one invalidates existing checkpoints.
  .addNode('ingest', ingest)
  .addNode('aggregate', aggregate)
  .addNode('post', post)

  // ── The wiring. ──
  // These four edges are the control flow that used to be nothing more than the
  // ORDER OF THE AWAITS inside reviewPullRequest. Making it data is what lets
  // LangGraph stop between steps and pick up again later.
  //
  // START and END are sentinel constants, not nodes you write. The START edge
  // declares the entry point; without one, compile() fails.
  .addEdge(START, 'ingest')
  .addEdge('ingest', 'aggregate')
  .addEdge('aggregate', 'post') // ← Phase 5 splices `humanReview` into THIS edge
  .addEdge('post', END)

  // ── Compile. ──
  // Validates the structure (entry point present, no dangling edges, no
  // unreachable nodes) and returns a runnable graph. Handing it the checkpointer
  // is what makes LangGraph serialize + save the merged state after EVERY node.
  .compile({ checkpointer });

/**
 * The thread id for one pull request.
 *
 * A checkpointer holds many independent histories; `thread_id` picks which one a
 * run belongs to. Same id → LangGraph loads the saved state and CONTINUES it.
 * Different id → a fresh run. One PR = one thread (PROJECT_PLAN step 15), which
 * is what will let you approve at 16:40 a draft the agent wrote at 14:02.
 *
 * It lives here, next to the graph, because thread identity is graph vocabulary
 * — callers shouldn't have to know the format.
 */
export function threadIdFor(pr: { owner: string; repo: string; prNumber: number }): string {
  return `${pr.owner}/${pr.repo}#${pr.prNumber}`;
}
