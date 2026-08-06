# PR Review Agent — Working Agreement & Guide

> Authoritative doc for **how we build this together**. The step-by-step
> technical plan lives in [`PROJECT_PLAN.md`](./PROJECT_PLAN.md). This file is
> about *the way we work* and the concepts you're learning.

---

## 0. Most important thing: I am learning

**Srittam is new to LangChain and LangGraph.** The point of this project is not
just to ship the agent — it's to *learn these technologies while building it*.

So the rules for you (the assistant) are:

### Go slow. One step at a time.
- **Never dump the whole implementation at once.** Build in small, digestible
  increments — ideally one node / one concept / one file per step.
- After each step, **stop and let me run it, read it, and ask questions**
  before moving on. Don't race ahead to the next phase.
- If a step is getting big, split it. Small wins keep me learning.

### Teach, don't just do.
- **Before writing code**, explain in plain English *what* we're about to build
  and *why* — what problem this step solves.
- **When introducing a new LangChain/LangGraph concept**, pause and explain it:
  what it is, why it exists, how it fits the bigger picture. Concepts I'll meet
  include: `StateGraph`, nodes & edges, state/reducers, conditional edges,
  `Send` / fan-out, **checkpointers**, **`interrupt()` + human-in-the-loop**,
  `Command(resume=…)`, structured output, and tool/model binding.
- Use a quick analogy or a tiny standalone example when a concept is abstract.
- **After writing code, walk me through it** — what each part does, especially
  the LangGraph-specific bits. Don't assume I know the API.

### Check understanding.
- End meaty steps with a one-line **"✅ You now understand: …"** recap.
- It's fine to ask me *"does this make sense before we continue?"*
- If I ask "why", give the real reason, including tradeoffs — not a hand-wave.

### Keep me oriented.
- At the start of a step, say **where we are** in `PROJECT_PLAN.md`
  (e.g. "Phase 3, step 14 — wiring the first graph").
- Prefer showing the *shape* first (types, function signature, the graph
  diagram) before filling in bodies.

### Respect what I already know.
- I'm **not** new to TypeScript/Node — my `morning-briefing-agent` is a
  TS monorepo with Prisma, Express, an AI SDK, and a React/Vite client. Don't
  over-explain general JS/TS, npm, git, or REST. **Do** explain LangGraph,
  LangChain, GitHub App auth, and webhook specifics.

### I write the code. You tell me what to write. ← (from Phase 3 onward)
- **Do not edit source files for me.** No `Edit`/`Write` on anything under
  `packages/**` unless I explicitly ask ("you do this one").
- Instead, per step: name the **target file path**, show the code in a fenced
  block for me to type or copy, explain it, then give me the **exact command to
  run** and **what I should see**.
- Then **stop and wait** for me to report back before the next step. Typing it
  myself is how I learn — that's the whole point.
- Docs/plan files (`CLAUDE.md`, `PROJECT_PLAN.md`, `.env.example`) you *may*
  edit directly. The rule is about source code.

---

## 1. What we're building (one paragraph)

A **GitHub PR review agent**. When a PR is opened/updated, a bot (named after
me) reads the diff, reviews the code with an LLM, drafts inline comments, and —
**after I approve them (human-in-the-loop)** — posts them to the PR. The
learning centerpiece is LangGraph's durable, resumable **`interrupt()`** that
pauses the agent to wait for my approval. Full design → `PROJECT_PLAN.md`.

---

## 2. Stack (see PROJECT_PLAN.md §2 for the reasoning)

- **LangGraph.js (TypeScript)** — matches my existing stack.
- **GitHub App** for the bot identity + PR read/write.
- **Webhook** (`pull_request` events); `smee.io` tunnel in dev.
- **Anthropic Claude** as the review model.
- **Postgres** — LangGraph `PostgresSaver` checkpointer + Prisma run history.
- **React + Vite** approval UI (reuse the sibling project's client scaffold).
- Monorepo: `packages/server` + `packages/client` (npm workspaces).

> These are recommendations, not locked. If a choice trips me up while learning,
> we can revisit it. (Open questions still live in `PROJECT_PLAN.md` §8.)

---

## 3. How a typical step goes (the loop we repeat)

1. **Orient** — "We're at Phase X, step N. Goal of this step: …"
2. **Teach** — explain the concept(s) and the plan in plain English.
3. **Show shape** — types / signatures / graph diagram first.
4. **Hand off** — give me the file path + the small increment of code to write.
   *I* type it; you don't touch `packages/**` (see §0).
5. **Walk through** — explain the code I just wrote, LangGraph bits especially.
6. **Run it together** — tell me exactly what to run and what I should see.
7. **Recap** — "✅ You now understand: …" and confirm before the next step.

---

## 4. Conventions

- Match `morning-briefing-agent` conventions: ESLint + Prettier config, npm
  workspaces, `.env.example` kept in sync, Prisma for the DB.
- Keep secrets in `.env` (git-ignored); document every new var in `.env.example`.
- Small, focused commits per step so the learning history is legible.
- Never post to a real PR without my approval — that's the product's whole point.

---

## 5. Where things are

- `PROJECT_PLAN.md` — the phased, step-by-step build plan (authoritative technical plan).
- `CLAUDE.md` — this file (how we work + learning goals).
- `packages/server` — agent, graph, GitHub + webhook, HITL API.
- `packages/client` — approval UI.

---

## 6. Current status

- [x] Plan written (`PROJECT_PLAN.md`)
- [x] Working agreement written (this file)
- [x] Phase 0 (code) — monorepo scaffold, deps installed, `.env.example`,
      client↔server wiring proven (`/api/health` via Vite proxy)
- [x] Phase 0 (manual) — GitHub App created & installed on `sritMishra/PR-preview-agent`;
      `.env` filled (`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`)
- [x] Phase 1 — webhook endpoint verifies signatures, guards drafts/bots, and
      logs reviewable PRs; proven end-to-end via smee (`smee.io/DIUiZX8oxOozDZS`)
- [x] Phase 2 — GitHub read/write plumbing wired end-to-end: a real PR event
      now auto-mints a token, reads the PR, and posts a (dummy) review under the
      bot. Proven via smee + a live PR on `sritMishra/PR-preview-agent`.
- [x] Phase 3 — LangGraph skeleton: `ReviewState` (channels + reducers), three
      nodes, and a compiled `StateGraph` (`ingest → aggregate → post`) that the
      webhook now drives. Findings are stubbed; no LLM.
      **Deviation from the plan:** step 15 said `PostgresSaver`; we shipped
      `MemorySaver` instead (same interface, one-line swap) so this phase stayed
      about graph mechanics rather than DB setup. Postgres comes just before
      Phase 5, where surviving a restart starts to matter.
      *Verified:* `typecheck` clean + `verify-graph.ts` prints the intended
      topology. *Live webhook → graph → real PR round trip: to confirm.*
- [ ] **Next: Phase 4 — real review intelligence (`filterAndChunk` diff parsing +
      line mapping, then `analyze` with category prompts, structured output, and
      parallel fan-out per file; `aggregate` gains dedupe/cap/ranking)**

### Phase 3 — important notes & learnings

- **Why a graph at all (the one-line version):** you can't pause a function —
  its work-in-progress lives on the call stack, which isn't serializable. So
  LangGraph moves the locals into an explicit **state object** and the control
  flow into an explicit **graph**, making both plain data that can be saved and
  reloaded by a different process. Nodes are the *price of pausability*, not an
  organisational preference — and node boundaries are the only places a run can
  checkpoint, pause, resume, retry, or fan out.
- **State = channels + reducers** (`graph/state.ts`). A node returns a *partial*
  state; the reducer decides how that patch merges. `Annotation<T>` (no parens —
  a TS instantiation expression) = last-write-wins; `Annotation<T>({reducer,
  default})` = custom. `findings`/`errors` use `concat` **because Phase 4's
  `analyze` fans out in parallel** — with last-write-wins the slowest branch
  would silently erase every other branch's findings.
- **State must be JSON-serializable** — the checkpointer persists it after every
  node. That's why `installationId: number` is a channel and each node
  re-derives its Octokit from it, instead of carrying the live client. Costs one
  extra token mint per run; that's the honest price of durability.
- **Nodes are plain TypeScript** (`graph/nodes.ts` imports zero LangGraph). They
  re-implement nothing — they call the Phase 2 `github/*.ts` functions. So they
  can be unit-tested by passing a plain object.
- **`aggregate` is a pure transform**, deliberately. Phase 4 replaces that one
  body with the LLM fan-out and `post` doesn't change, because both sides talk
  only through `findings`/`summary` in state.
- **Node names are schema, not labels:** checkpoints record progress *by node
  name*, so renaming one invalidates existing checkpoints. TypeScript
  accumulates the names as you `addNode`, so a typo'd `addEdge` target is a
  compile error.
- **`invoke(input, config)` — two different worlds.** `input` (our `ReviewRequest`)
  IS the initial state, merged through the same reducers a node's return value
  would be; that's why `ReviewRequest`'s four fields are exactly `ReviewState`'s
  four input channels. `configurable.thread_id` is **not** state — it's metadata
  selecting which saved history the run belongs to. Nodes never see it.
- **`thread_id = ${owner}/${repo}#${prNumber}`** (`threadIdFor`). One PR = one
  durable conversation. **Known consequence:** a `synchronize` event reuses the
  thread, so run #2 loads run #1's state and `concat`s onto it — findings
  over-report. Left in on purpose; the fix (head-SHA-scoped thread, or resetting
  `findings` in `ingest`) is `PROJECT_PLAN.md` step 28.
- **`verify-graph.ts`** prints the compiled graph as Mermaid via
  `getGraphAsync({}).drawMermaid()` — no network, nothing posted, safe to re-run
  (unlike `verify-post.ts`). Worth keeping as Phase 4/5 make the topology
  non-obvious. Run it **from `packages/server/`**: `config.ts` loads `.env` from
  the cwd, so running from the repo root fails env validation.
- **`review-pr.ts` is now an adapter,** not orchestration: event → graph run, and
  it owns thread identity. Phase 5's HITL API needs a *second* entry point into
  the same graph (`Command(resume=…)` on an existing thread) — it belongs here.

### Phase 2 — important notes & learnings

- **Three auth identities** live in `github/app.ts`, all via `@octokit/auth-app`:
  - `getAppOctokit()` — JWT-only ("ID badge"); App-level calls only (e.g. list
    installations). Can't read repo contents.
  - `getInstallationOctokit(id)` — the "room key"; scoped installation token
    that reads diffs and posts reviews. Octokit mints + auto-refreshes it.
  - The installation id is **not stored** — it arrives on every webhook at
    `payload.installation.id`. (Our test install id: `147408011`.)
- **GitHub media types:** `GET /pulls/{n}` returns JSON normally, but the raw
  unified diff *text* when you send `Accept: application/vnd.github.diff`
  (Octokit: `mediaType: { format: 'diff' }`). See `fetchPullRequestDiff`.
- **Reviews are all-or-nothing:** a review bundles `body` + `event` + inline
  `comments[]` in ONE call; if any inline comment anchors to a line not in the
  diff, the whole call 422s. We always send `event: 'COMMENT'` (never auto
  APPROVE/REQUEST_CHANGES — principle #1). Inline anchoring proper = Phase 4.
- **The seam:** `review-pr.ts` (`reviewPullRequest`) holds the orchestration;
  the webhook only routes + guards, then fires it. Phase 3 swaps this function
  body for the LangGraph run — signature and call site stay identical.
- **Fire-and-forget:** the webhook does NOT await the review, so GitHub gets its
  200 inside the timeout; a `.catch` keeps a failed review from crashing the
  process (fail-soft, principle #5).
- **Identity decision (D2):** briefly explored posting as the user (a PAT, no
  `[bot]` badge) but reverted — staying with the GitHub App bot identity for now.
- **Dev tooling:** the package to install is **`smee-client`**, but the binary it
  provides is **`smee`** (`"bin": { "smee": "bin/smee.js" }`) — dependency name
  and command name differ. So `npm run tunnel` must invoke `smee`; invoking
  `smee-client` fails with `127: command not found`. (The earlier "`npx smee`
  could not determine executable to run" error was npx trying to *download* an
  unrelated registry package, back before `smee-client` was a local
  devDependency. Now that it is, `npx smee` resolves `node_modules/.bin/smee`.)
- **`verify-*.ts` scripts** (`verify-auth`, `verify-read`, `verify-post`) are
  standalone dev tools run by hand with `npx tsx` — never imported by the server.

_(Keep this checklist updated as we go so we always know where we are.)_
