# PLAN.md — build plan (Fri Aug 7)

Two people, ~5 hours of build time, hard submission at 4 PM (confirm exact times at check-in). Person A owns UI, Person B owns engine — see AGENTS.md → Territories. Every milestone ends with the app in a demoable state, `npm run build` passing, and a commit.

**Prime directive: build DEMO.md, in order. Nothing else until the script runs end to end.**

## Timeline

| Time | Person A (UI/tree) | Person B (engine) |
|---|---|---|
| 10:00–11:00 | Sponsor talks — note what EverMind/Snowflake engineers emphasize; verify keys work | same |
| 11:00–11:30 | **M0** scaffold, push, deploy to Vercel, agree contracts | **M0** contracts + client stubs |
| 11:30–1:00 | **M1** chat pane + tree sidebar on seed fixture (mock API) | **M1** context compiler + Snowflake model layer (real) |
| 1:00–2:00 | **M2** branch flow UI, routing chip, hover details, override | **M2** router + escalation + inference logging |
| 2:00–2:45 | **M3 (joint)** integration: swap mocks for real engine | **M3 (joint)** integration + EverMind wiring |
| 2:45–3:15 | **M4** merge-insight UI + economics panel | **M4** merge extraction + baseline-vs-actual math |
| 3:15–3:30 | Buffer / execute cuts | Buffer / execute cuts |
| 3:30–4:00 | **FREEZE.** Backup recording, rehearse 3× , submit | same |

## Milestones

**M0 — Skeleton + contracts (both, 30 min).**
A: `create-next-app` (TypeScript, Tailwind, App Router), push to GitHub, connect Vercel, deployed URL live. B (in same repo once pushed): write `lib/types.ts` — `Conversation`, `Message`, `BranchNode`, `ContextBrief`, `RoutingDecision {tier: quick|thoughtful|deep, model, effortNote, contextTokens, estCostUsd, reason}`, `InferenceLog`, `Insight` — and API route signatures: `POST /api/chat`, `POST /api/branch`, `POST /api/merge`, `GET /api/economics`. **Types are frozen after M0** — changes only by voice agreement between A and B.
*Done when:* deployed URL renders, types committed, both agents can work independently.

**M1 — Walking skeleton.**
A: two-pane layout — tree sidebar (react-flow or a simple indented tree; don't gold-plate) + chat pane; loads `fixtures/seed-conversation.json`; running token counter; all data via the API routes (mocked). B: `lib/llm.ts` — Snowflake Cortex `AI_COMPLETE` client with model param + token/cost accounting, and a mock mode that activates automatically when env vars are missing; `lib/compiler.ts` — given parent messages + a selected topic/question, produce a `ContextBrief` (small LLM call): relevant facts only, **referents resolved** ("apps" → "Free Ventures applications"), explicit excluded-context note.
*Done when:* A can chat against mocks on the deployed URL; B's scratch script (`scripts/try-engine.ts`) shows a real Cortex round-trip and a compiled brief for the two DEMO.md questions.

**M2 — Branch + route.**
A: highlight/select → Branch button → new tree node with pruned-% badge on the edge; ⚡/🧠/🔬 chip per response with hover detail card and a manual override menu (override scoped to the branch = pinning). B: `lib/router.ts` — one cheap classifier call rates task complexity 1–3 → tier {quick, thoughtful, deep} → {model, effort, context budget}; pinned branches skip classification; start-cheap-then-escalate on a failed sanity check; every inference appended to the log (Snowflake table if trivial to set up, else local JSON — the economics panel doesn't care which).
*Done when:* the two DEMO.md questions route ⚡ and 🔬 respectively through B's engine in isolation, and A's UI shows chips/overrides against mocks.

**M3 — Integration (pair on this; one keyboard per conflict).**
Swap A's mocks for B's real engine behind the same contracts. Wire EverMind: on merge-insight and on branch creation, write/read durable memories via EverOS v1 API (`lib/memory.ts`, with local JSON fallback). Run DEMO.md Beats 1–3 on the deployed URL.
*Done when:* Beats 1–3 work live, twice in a row.

**M4 — Merge + economics.**
A: Merge-insight button + animation of the distilled line flowing to the parent; economics panel (table of inferences + session totals + baseline comparison). B: merge extraction (small LLM call distills the branch's durable conclusion); baseline math = sum of full-history token counts the same requests *would* have cost.
*Done when:* the full DEMO.md script runs end to end on the deployed URL.

## Cut lines (execute in this order when behind)

1. Router "learning" table/stats → static heuristic router, keep the chip + override (the flywheel is pitch, not code).
2. Snowflake logging table → local JSON log feeding the same economics panel.
3. EverMind live → local memory store; the merge UX is what judges see either way.
4. Tree animations/polish → plain indented tree.
5. Economics panel → two big numbers: tokens saved %, cost saved %.

**Never cut:** branch + compiled brief with pruned-%, the ⚡/🔬 contrast on the two demo questions, merge-insight, the counters. That's the whole pitch.

## Rules of engagement

- Commit at every green milestone; small commits; both on `main`; never edit outside your territory (AGENTS.md).
- Real demo data lives in the fixture, never typed live. If the fixture changes, re-run the demo questions.
- 3:30 freeze is sacred. A feature at 3:45 has negative value.
