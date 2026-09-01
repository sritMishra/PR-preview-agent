# PR Review Agent — Project Plan

> Module 2 (Week 3–5). The goal is to **learn LangGraph properly**: a multi-step
> agent with **human-in-the-loop**. This doc is the authoritative plan — update
> it as decisions are made.

---

## 1. What this is

An agent that watches a GitHub repo. **Every time a PR is opened (or updated),
the agent — posting under a bot identity named after you — reads the diff,
reviews the code, and leaves inline comments plus a summary review for the
developers.**

Critically, this is a **human-in-the-loop** agent (the module's core learning
goal): the agent drafts a review, **pauses**, and shows you the draft. You
approve / edit / reject. Only approved comments get posted to GitHub. This is
what makes it portfolio-worthy and what LangGraph's `interrupt()` +
checkpointer machinery exists for.

### What it is NOT
- Not an auto-merger, not a CI gate (v1). It reviews and comments only.
- Not a linter replacement — it reasons about correctness/design, and defers
  style to existing tooling.

---

## 2. Key decisions (locked-in recommendations)

These shape everything below. Recommendations given; flag any you want to change.

| # | Decision | Recommendation | Why |
|---|----------|----------------|-----|
| D1 | Language / framework | **LangGraph.js (TypeScript)** | Matches your `morning-briefing-agent` monorepo, Prisma, AI SDK ecosystem. (Python LangGraph is the alternative — slightly more mature `interrupt`/checkpointer docs and arguably more common in EU job posts. If portfolio > consistency, switch to Python.) |
| D2 | GitHub integration | **GitHub App** (not a PAT) | Gives a dedicated bot identity ("your-name-bot") with its own avatar, per-repo install, fine-grained scopes, and higher rate limits. PAT would post as *you personally*, which is fine for a solo demo but not a real product. |
| D3 | Trigger transport | **Webhook** (`pull_request` events) → your server. Use `smee.io` to tunnel to localhost in dev. | Real-time, event-driven. (A GitHub Action is the fallback if you can't host a webhook, but it doesn't fit the LangGraph-server-with-HITL model as cleanly.) |
| D4 | HITL approval surface | **Small web UI** (reuse the `packages/client` React+Vite pattern) + optional Slack DM notification | You already have the client scaffold. The approval screen is the demo centerpiece. |
| D5 | LLM | Anthropic Claude (Opus/Sonnet) via AI SDK or LangChain's `@langchain/anthropic` | Best code-reasoning; you already have the AI SDK wiring pattern. |
| D6 | Persistence | **Postgres** — LangGraph `PostgresSaver` checkpointer for graph state + a Prisma table for run/review history | Checkpointer is what enables pause/resume across the HITL interrupt. |

---

## 3. Architecture at a glance

```
GitHub PR opened
      │  (webhook: pull_request.opened / .synchronize / .reopened)
      ▼
┌─────────────────────────────────────────────────────────┐
│ Server (packages/server)                                  │
│  • verify webhook signature                               │
│  • dedupe / enqueue                                       │
│  • start LangGraph run (thread_id = repo#pr)              │
└───────────────┬───────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────┐
│ LangGraph review graph                                    │
│  ingest → filter/chunk → analyze(fan-out) → aggregate →  │
│  ─── interrupt() [HUMAN REVIEW] ─── → post → record      │
│         ▲ checkpointer persists state here                │
└───────────────┬───────────────────────────────────────────┘
                ▼ (draft shown)          ▲ (resume w/ decision)
        ┌───────────────┐                │
        │ Approval UI    │────approve/edit┘
        │ (packages/     │
        │  client)       │
        └───────────────┘
                │ on approve
                ▼
        GitHub: create Review with inline comments + summary
```

---

## 4. The LangGraph graph (the heart of the project)

**State** (`ReviewState`): PR metadata, raw diff, parsed hunks, list of
`DraftComment { path, line, side, severity, body, category }`, summary,
human decision, post result, errors[].

**Nodes:**

1. **`ingest`** — Fetch PR metadata, the unified diff (`GET .../pulls/{n}` with
   `Accept: application/vnd.github.diff`), changed-file list, and any existing
   review comments (to avoid repeating yourself on `synchronize` events).
2. **`filterAndChunk`** — Drop noise: lockfiles, generated code, vendored dirs,
   binary/deleted files, huge diffs (cap lines). Parse the diff into per-file
   hunks with real line numbers (needed for inline comment anchoring).
3. **`analyze`** (fan-out, one branch per file or per concern) — For each hunk,
   ask the LLM for findings. Prompt enforces categories: **correctness, security,
   performance, tests, readability**. Force **structured output** (Zod schema)
   so each finding has `{path, line, severity, category, body, suggestion?}`.
   Run branches in parallel (LangGraph `Send` / parallel edges).
4. **`aggregate`** — Merge findings, dedupe, drop low-confidence, cap count
   (e.g. top 15), and generate a natural-language **summary review**. Decide an
   overall event: `COMMENT` (never auto-`REQUEST_CHANGES`/`APPROVE` in v1).
5. **`humanReview`** — **`interrupt()`** here. Emit the draft (summary + comments)
   to the approval UI. Graph state is checkpointed; the process can even restart.
6. **`applyDecision`** — On resume, receive `Command(resume={ decision, edits })`.
   Apply edits, drop rejected comments.
7. **`post`** — Create a single GitHub **Review** (`POST .../pulls/{n}/reviews`)
   with `event: COMMENT`, a `body` (the summary), and a `comments[]` array of
   inline comments anchored to `path` + `line` + `side`. Handle position/line
   errors gracefully (fall back to a summary-only comment).
8. **`record`** — Persist run outcome (Prisma): PR, findings count, decision,
   posted comment IDs, tokens/cost, latency.

**Why HITL matters here:** the `interrupt()` between `aggregate` and `post` is
the whole point — it demonstrates a durable, resumable agent that waits for a
human, backed by a checkpointer. This is the story you tell in an interview.

---

## 5. Repository layout (monorepo, mirrors sibling project)

```
pr-review-agent/
├─ PROJECT_PLAN.md            ← this file (authoritative)
├─ package.json               ← npm workspaces
├─ .env.example
├─ packages/
│  ├─ server/
│  │  ├─ src/
│  │  │  ├─ index.ts           ← Express bootstrap
│  │  │  ├─ webhook.ts         ← /webhook: verify sig, enqueue, kick off graph
│  │  │  ├─ github/
│  │  │  │  ├─ app.ts          ← GitHub App auth (Octokit + installation token)
│  │  │  │  ├─ pr.ts           ← fetch diff/files/comments
│  │  │  │  └─ review.ts       ← post review + inline comments
│  │  │  ├─ graph/
│  │  │  │  ├─ state.ts        ← ReviewState + Zod schemas
│  │  │  │  ├─ nodes/*.ts      ← ingest, filter, analyze, aggregate, post…
│  │  │  │  ├─ prompts.ts      ← review prompts per category
│  │  │  │  └─ graph.ts        ← StateGraph wiring + checkpointer
│  │  │  ├─ hitl/              ← approval API (list pending, submit decision)
│  │  │  └─ llm.ts             ← model client (Anthropic)
│  │  └─ prisma/schema.prisma  ← ReviewRun, Finding tables
│  └─ client/                  ← React+Vite approval UI (reuse scaffold)
└─ .github/                    ← (optional) Action fallback
```

---

## 6. Phased build plan (step by step)

### Phase 0 — Scaffold & GitHub App (Day 1)
1. `npm init` workspaces; copy tsconfig/eslint/prettier from sibling project.
2. Install: `@langchain/langgraph @langchain/anthropic @octokit/rest @octokit/webhooks zod express prisma @prisma/client`.
3. **Create a GitHub App** (Settings → Developer settings → GitHub Apps):
   - Name it after you (this is the "agent with your name").
   - Permissions: **Pull requests: Read & Write**, **Contents: Read**, **Metadata: Read**.
   - Subscribe to events: **Pull request**.
   - Generate a private key + note App ID + webhook secret.
   - Install it on a **test repo** you own.
4. `.env.example` + `.env`: `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, `PORT`.

### Phase 1 — Webhook → "hello PR" (Day 1–2)
5. Express server with `POST /webhook`; verify signature with `@octokit/webhooks`.
6. Handle `pull_request` (`opened`, `reopened`, `synchronize`); ignore drafts/bots/own actions (avoid loops).
7. Dev tunnel: `npx smee -u https://smee.io/<id> -t http://localhost:PORT/webhook`.
8. ✅ **Milestone:** open a PR on the test repo → server logs the PR number/title.

### Phase 2 — GitHub read + write plumbing (Day 2–3)
9. `github/app.ts`: mint an installation token from the App creds (Octokit).
10. `github/pr.ts`: fetch diff, changed files, existing comments.
11. `github/review.ts`: post a hardcoded summary review + one inline comment.
12. ✅ **Milestone:** the bot leaves a real (dummy) comment on your test PR under its own name.

### Phase 3 — LangGraph skeleton (Day 3–4) — **DONE**
13. ✅ Define `ReviewState` + the `Finding` type in `graph/state.ts`.
    *(Findings are a plain TS type for now; the **Zod** schema arrives in Phase 4,
    where it's needed to force the LLM's structured output.)*
14. ✅ Wire a linear graph: `ingest → aggregate → post` (no LLM — stub findings).
    Nodes in `graph/nodes.ts`, wiring in `graph/graph.ts`.
15. ⚠️ **Deviation —** shipped the **`MemorySaver`** checkpointer, not
    `PostgresSaver`, so this phase stayed about graph mechanics instead of DB
    setup. Identical interface → one-line swap, scheduled just before Phase 5
    (where surviving a restart is the whole point). `thread_id` =
    `${owner}/${repo}#${prNumber}` via `threadIdFor()`.
16. ✅ **Milestone:** webhook triggers the graph, which posts the stubbed review.
    *(`typecheck` + `graph/verify-graph.ts` confirm the topology; the live
    webhook → graph → real PR round trip is pending final confirmation.)*

**Carried into later phases:**
- Swap `MemorySaver` → `PostgresSaver` (needs `DATABASE_URL`) — before step 22.
- Reusing one `thread_id` per PR means a `synchronize` re-run **appends** to the
  previous run's `findings` (concat reducer). Fix in step 28.

### Phase 4 — Real review intelligence (Day 4–6)

17. ✅ **`filterAndChunk`** — shipped in two commits.
    - **17a** (`8e59518`) — noise filters + whole-PR budgets (`graph/filters.ts`),
      the `filterAndChunk` node, and `reviewableFiles` / `skippedFiles` channels.
      One edge became two: `ingest → filterAndChunk → aggregate`.
    - **17b** (`a4d76e5`) — diff parsing and line mapping (`graph/chunks.ts`):
      hunk headers → true new-file line numbers → a per-file **commentable-line
      allow-list**, plus `anchorAll` (snap near-misses, demote the unanchorable)
      and a line-numbered rendering for the step-18 prompt. `post` now sends real
      `comments[]`. **Graph topology unchanged** — nodes talk only through state.
    - Pulled forward from step 29: `post` retries summary-only if GitHub rejects
      the batch, so one bad anchor can't cost the whole review.

18. **`analyze`** — the LLM. Split into three, no tokens spent until 18b:
    - **18a — the prompt, as a pure function.** Build the model's view from a
      `FileChunk` + PR metadata: the numbered rendering, the `+`/`-` markers, the
      explicit commentable-line allow-list. `verify-prompt.ts` prints exactly what
      the model would see. No API key, no LLM. *(Diff-only for the MVP — widening
      this view is **V2-1**, see Phase 7.)*
    - **18b — one call, one file.** `@langchain/anthropic` + a Zod schema forcing
      structured output (`{line, severity, category, body, confidence}`). The model
      never returns `path` — the branch already knows which file it holds.
      Findings pass through `anchorAll` exactly as the stubs do today.
    - **18c — the fan-out.** `Send` dispatches one branch per file. First topology
      change since 17a, and the first time `findings`' `concat` reducer earns its
      existence. Cap concurrency for rate limits.
19. Implement `aggregate` (dedupe, cap, severity ranking, summary generation).
20. Tune prompts on 3–5 real PRs; add a golden-set to eyeball quality.
21. ✅ **Milestone:** genuinely useful, correctly-anchored inline comments appear.

### Phase 5 — Human-in-the-loop (Day 6–8) ← the marquee feature
22. Insert **`interrupt()`** in `humanReview`; graph pauses with draft in state.
23. HITL API: `GET /reviews/pending`, `GET /reviews/:id`, `POST /reviews/:id/decision`.
24. `applyDecision` resumes the graph via `Command(resume=…)`; only approved/edited comments continue to `post`.
25. Approval UI in `packages/client`: list pending reviews, show diff + draft comments, per-comment approve/edit/reject, one "Post review" button.
26. (Optional) Slack DM notifying you a review is waiting (reuse sibling Slack code).
27. ✅ **Milestone:** open PR → get pinged → open UI → approve → comments post. End-to-end HITL.

### Phase 6 — Hardening & polish (Day 8–10)
28. Idempotency: on `synchronize`, only review new commits; don't repost duplicates (dedupe vs existing comments).
29. Fail-soft: partial results if one file errors; summary-only fallback if inline anchoring fails; retries + backoff on GitHub 5xx/rate limits.
30. Persist `ReviewRun`/`Finding` (Prisma) — cost, latency, decision, outcome.
31. Tests: unit (diff parser, filters, schema), integration (mock Octokit + webhook fixtures).
32. README + short demo GIF (portfolio!). Document the graph diagram and the HITL story.
33. Deploy (Railway, like sibling): server + Postgres; register the production webhook URL on the GitHub App.

---

### Phase 7 — V2: reviewer context (post-MVP)

> Everything above ships first. **The MVP is allowed to be less smart.** This
> phase begins the moment the MVP is working end to end, and V2-1 is the single
> highest-priority item in the project after it.

#### 🔴 V2-1 — Give the reviewer real context. **HIGH PRIORITY — start here.**

**The problem.** v1 shows the LLM only the changed hunks. Even a reviewer seeing
a codebase for the very first time scrolls up, reads the imports, and looks at
the rest of the function before commenting. Ours cannot — it reads through a
keyhole. That caps it at "problems visible inside the diff" and is the single
biggest limit on review quality. It is a v1 *compromise for speed*, not a
considered scope decision.

**The principle: read wide, comment narrow.** What the model may READ and what it
may COMMENT ON are two different things — they are only accidentally identical
today. Widen the rendered view; leave the commentable-line allow-list from 17b
exactly as it is. Every piece of anchoring and validation machinery survives
untouched, because a human reviewer works the same way: read the file, comment on
the diff.

**Work items, in order:**

1. `github/pr.ts` — `fetchFileAtRef(octokit, ctx, path, sha)`: file contents at
   the PR head. Needs a new `headSha` state channel (`ingest` currently discards
   it).
2. Feed the file into the 18a prompt builder **alongside** the diff, not instead
   of it. The file shows the current state; only the diff shows what was
   **removed**, and deleted code is often where the author's intent lives.
3. **Context-window optimisation — this is the real design work. Do not just
   "send the whole file".**
   - Start with a **window** around each hunk (±N lines) plus the file's import
     block. Usually as good as the whole file, at a fraction of the tokens.
   - **Measure before widening:** tokens/PR, cost/PR, and whether the findings
     actually change. A bigger window that produces identical findings is pure
     cost.
   - Escalate to whole-file only under a size threshold.
   - Consider a cheap **context-summariser pass** — a smaller, faster model that
     condenses a large file down to the parts relevant to this diff — before
     paying for a large window on the expensive model. It must beat "just send a
     bigger window" on quality-per-token, or it's an extra hop for nothing.
4. Re-tune prompts once the view widens. The 18a prompt says *"you are seeing
   only the changed portion of one file"* — that sentence becomes a lie and will
   actively suppress findings if left in.

#### V2-2 — Cross-file impact: *"will this break anything else?"*

The question neither a diff nor a single file can answer. Give `analyze` tools
(`read_file`, `grep_repo`) so it can go find the callers of a renamed symbol.
Turns the node into a small agent loop — retry semantics, token budget, a stop
condition — and introduces **tool/model binding**, a `CLAUDE.md` learning goal
not yet met.

#### V2-3 — Whole-repo retrieval (RAG)

Index the repository for semantic retrieval. Heaviest option: indexing pipeline,
storage, staleness. Only worth it if V2-1 and V2-2 leave a real gap.

---

## 7. Guiding principles

1. **Human-approved by default.** No comment reaches a developer without your OK
   (v1). This is a feature, not a limitation — it's the learning goal.
2. **Signal over noise.** Cap comment count, rank by severity, suppress
   nitpicks that linters already catch. A 40-comment review gets ignored.
3. **Never loop.** Ignore the bot's own events and other bots.
4. **Idempotent + resumable.** Checkpointer + watermark on commits → re-runs
   don't duplicate, missed runs don't drop.
5. **Fail soft.** A partial review beats a crash; always say what failed.
6. **Cost-aware.** Skip giant/generated diffs; log tokens per run.

---

## 8. Open questions to confirm

- **Q1 — Language:** ✅ **Settled: LangGraph.js (TypeScript).** Built through Phase 3 on `@langchain/langgraph` v1.
- **Q2 — Approval surface:** ⏳ **Still open**, and due in Phase 5. Web UI (assumed) vs approving directly inside GitHub (e.g. the agent posts *pending* comments and you convert them) vs Slack buttons?
- **Q3 — Scope of review:** ✅ **Settled for the MVP: diff-only.** `ingest` fetches the unified diff + changed-file list; the LLM sees only the changed hunks. ⚠️ **This is a speed compromise, not a considered scope decision** — it is deliberately revisited as **V2-1 (Phase 7), the top post-MVP priority**, which widens the model's view to the changed files themselves under a "read wide, comment narrow" rule. Whole-repo RAG stays a stretch goal (V2-3).
- **Q4 — One repo or many?** ✅ **Settled for v1: one test repo** (`sritMishra/PR-preview-agent`). Nothing in the code hardcodes it, though — the installation id arrives per webhook and `thread_id` is namespaced by `owner/repo`, so multi-install works without changes if we want it.
```
