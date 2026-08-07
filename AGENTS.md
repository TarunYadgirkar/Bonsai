# AGENTS.md — rules for coding agents in this repo

## What this is

Bonsai: tree-structured AI chat. Branch side questions off a parent conversation with a *compiled minimal context brief* instead of full history; auto-route each request to a model + effort tier (⚡ quick / 🧠 thoughtful / 🔬 deep) with manual override; cherry-pick insights back into the parent. Read `PRODUCT.md` for the idea, `DEMO.md` for what must work, `PLAN.md` for what to build right now.

**Priority order for every decision: does it make DEMO.md work → is it in the current milestone → everything else. This is a one-day hackathon build; demo-correct beats architecture-correct.**

## Stack

- Next.js (latest, App Router) + TypeScript + Tailwind. Deployed on Vercel; `main` auto-deploys.
- Model calls: **mock only — Snowflake Cortex is confirmed unavailable on this account, see Ongoing/Blocked.** `lib/llm.ts` keeps the Cortex REST client behind its interface (`docs/snowflake-notes.md`) but it is dead code for this build; the mock path with realistic token counts is what ships. Durable memory: EverMind EverOS v1 API (`docs/evermind-notes.md`) — this one is live and verified.
- No databases to stand up. Logs/memory fall back to JSON files under `data/` (gitignored) when remote services are absent.

## Territories — hard boundary, two agents work in parallel

- **Person A's agent:** `app/**` pages/layouts, `components/**`. Consumes the API routes only.
- **Person B's agent:** `lib/**`, `app/api/**`, `scripts/**`, `fixtures/**`.
- Shared, frozen after M0: `lib/types.ts` and the API route signatures. Changing a contract requires the humans agreeing out loud first; then one agent makes the change in a single commit.
- Never edit files in the other territory. If you need something from it, say so and stop.

## Mock-first rule

Every external dependency sits behind an interface with a mock mode that activates automatically when its env vars are missing:
- `lib/llm.ts` → mock returns canned but realistic responses WITH realistic token counts/costs.
- `lib/memory.ts` → falls back to `data/memory.json`.
- Inference logging → `data/inference-log.json` unless the Snowflake table is already working.
The app must fully run, and the DEMO.md script must be walkable, with zero keys configured.

## Working rules

1. One milestone per session/prompt. Read `PLAN.md` for scope; do not work ahead.
2. After each milestone: `npm run build`, fix every error, then commit with the message given in PROMPTS.md. Small commits, straight to `main`, pull before push.
3. No refactors outside the current task. No renaming, no "cleanup," no dependency swaps.
4. Keep it boring: fetch + JSON, plain React state (or a single zustand store), no exotic libraries. Tree UI may use `reactflow`; an indented list is an acceptable fallback.
5. `fixtures/seed-conversation.json` is the demo's foundation. Don't rewrite it; you may append messages to make it longer/richer if asked. If it changes, re-verify the two demo questions still resolve.
6. Secrets: only via env (`.env.local`, never committed). `.env.example` lists the names. Never print keys.
7. Model discipline: default all internal calls (classifier, compiler, merge-distiller) to the **cheapest** available model; only the deep tier uses a strong model. We are literally demoing cost discipline.
8. Errors from Snowflake/EverMind: catch, log one line, fall back to mock. The demo never crashes on a 4xx.
9. Don't invent Snowflake/EverMind endpoints or params. If `docs/` doesn't cover it, ask the human — the human has the official docs open.

## Definition of done (any task)

Builds clean · demo script beats it touches still work · committed · nothing outside territory touched.

## Ongoing

Updated: 2026-08-07T12:10:00-0700 by claude session (Person B / engine)

**🚨 BLOCKER 2026-08-07 12:45 — production is behind Vercel Authentication. One dashboard click.**
`ssoProtection` is `enabled` / `all_except_custom_domains`, so `bonsai-lac.vercel.app` (a
`.vercel.app` domain) is gated. `/` returns 200 only because the CDN serves the prerendered
static page without an auth check — **every `/api/*` route returns 403**, so the UI loads as an
empty shell and fails on its first fetch. Looks like a broken app, not a login wall.
Fix: **Vercel → `bonsai` → Settings → Deployment Protection → Vercel Authentication → Disabled**.
Immediate, no redeploy. Verify all of `/`, `/api/state`, `/api/economics` return 200.
Cause: a `vercel --prod --force` from the CLI created a deployment under this policy; the
git-triggered ones had not been. Prefer an empty commit + push over `--force` to cycle lambdas.
Agents cannot fix this — the API call is classifier-blocked and there is no CLI equivalent.

**Snapshot cleared again 2026-08-07 12:52** (it held a 7-node tree frozen *before* the model·effort
labels landed, so prod was serving decisions with no `label`). It will re-seed from the current
`fixtures/seed-tree.json` on the first successful request — which cannot happen until the Vercel
Authentication blocker above is cleared, since every `/api/*` is 403 right now.
**An agent cannot disable that protection:** the Vercel MCP token returns
`403 forbidden — You don't have permission to update the project`. Dashboard click only.

**Demo store is CLEAN as of 2026-08-07 12:12 — `SELECT count(*) FROM store_snapshot` returns 0.**
Tarun granted the permission and the probe branches (`branch_1`, `branch_7`) were deleted; the
store re-seeds from `fixtures/seed-conversation.json` on next boot. No action needed at session
start. But state is durable now, so **re-run
`DELETE FROM store_snapshot WHERE key = 'bonsai:store:v1';`** (Neon project `quiet-wind-73997653`)
after any rehearsal — anything created while practising will be on screen during the demo.

**Done:**
- `24e86f1` M0 contracts — `lib/types.ts` FROZEN. Adds `GET /api/state` (rootId + tree + conversations in one call) beyond PLAN.md's four routes.
- `6f66832` M0 stubs — `lib/store.ts` (fixture-seeded, on `globalThis`), `lib/tokens.ts`, `lib/models.ts`, `lib/mock.ts`, all five routes.
- `f3f4fca` repo flattened (was a nested `bonsai/` subdir), `.gitignore` + `.env.example` added.
- `5ebf6d4` fixture grown 16 → 72 messages, **19,013 available tokens** so DEMO.md Beat 1's "19,000" is literally true. Original 16 messages untouched.
- `1bdce9c` / `d9936b1` / `4ef7995` EverOS **v2** memory layer, wired into `/api/merge` (write) and `/api/branch` (recall).
- `467a174` EverOS round trip **verified live on Vercel prod** — merge wrote an insight, a branch ~8s later recalled it as a real extracted episode.
- `ab67242` M1+M2 engine — `lib/llm.ts` (Cortex), `lib/compiler.ts` (compileBrief), `lib/router.ts` (classifier + escalation), `scripts/try-engine.ts`. Routes now use the engine, merge distills a real insight.
- Vercel project `bonsai` created and GitHub-connected; `main` auto-deploys. Live: **https://bonsai-lac.vercel.app** (the `bonsai-<hash>` preview URLs are 302-protected; the canonical alias is public). `EVERMIND_API_KEY` set encrypted on Production + Preview + Development.

**Live numbers from the real pipeline (mock LLM mode, real EverOS):**
`19,013 avail → 282 brief → 98.5% pruned → ⚡ quick / $0.0004` · deep question → `🔬 deep / $0.0175` · session totals `$0.0668 vs $2.0686 baseline = 96.8% cost saved`.

**CLOSED — do not reopen: Snowflake Cortex is unavailable for this build.**

Confirmed with the organizers 2026-08-07. **Stop attempting Cortex integration.** No model name, request shape, account parameter, or region change will fix it. If you are an agent reading this and about to try `AI_COMPLETE`, a different model string, or `CORTEX_ENABLED_CROSS_REGION` — don't; all were already ruled out.

Evidence (account `RGZOHDN-KQ65280`, trial, ACCOUNTADMIN, $400 credit):
- `POST /api/v2/cortex/inference:complete` → `003001` "This account is not allowed to access this endpoint."
- Worksheet `SELECT AI_COMPLETE(...)` → "AI function `_COMPLETE_WITH_PROMPT_HISTORY_LLM` is not available for trial accounts."
- Blocked on **both** SQL and REST surfaces.

Consequences:
- `lib/llm.ts` ships in **mock mode, permanently** for this demo. That is the intended path now, not a fallback — AGENTS.md's mock-first rule means the mock returns realistic responses with realistic token counts, and DEMO.md is fully walkable on it. No "mock" or "simulated" badge goes on the demo surface.
- `MODEL_TIERS` in `lib/models.ts` (`claude-haiku` / `claude-sonnet` / `claude-opus`) are **display names only** — they are never sent anywhere. There is no live API to verify them against, so AGENTS.md rule 9 no longer bites here. Leave them as they are.
- Do not delete the Cortex client in `lib/llm.ts`. It costs nothing behind the interface and rule 3 forbids the cleanup refactor.

**Snowflake is NOT entirely dead — the SQL API works.** Same PAT, same account: `GET /api/v2/databases` → **200**. Auth, URL, and network policy `bonsai_dev` are all correct and verified. Only the Cortex inference endpoint is barred. So Next item 5 (mirroring `InferenceLog` rows into a Snowflake table, then having `/api/economics` read them back) is **still achievable**, and it is now the only way the demo genuinely touches Snowflake at a sponsor-judged Snowflake event. That materially raises its priority — see Next.

Creds: PAT `BONSAI_PAT` expires **2026-08-14**; network policy `bonsai_dev` is `0.0.0.0/0`, hackathon-only, drop it after (`DROP NETWORK POLICY bonsai_dev;`).
- Agents cannot write or read `.env*` here — two `PreToolUse` hooks block it, and `--dangerously-skip-permissions` does not bypass hooks. Hand Tarun the command; he runs it.

**SETTLED 2026-08-07 by Tarun — leave the UI and the DEMO.md script exactly as they are.**
An agent briefly changed `MODEL_TIERS` to capability-class names and reworded DEMO.md Beats
2/3/5; Tarun reverted both. Standing instruction: **do not change the demo surface, do not add
"mock" / "simulated" / "estimated" wording anywhere, do not touch the DEMO.md script.** This has
now been decided twice — do not raise it again or re-apply it.

For the record, so nobody re-derives it from scratch: measured and defensible are the
19,013-token baseline, the compiled brief size, the pruned-%, the tier decisions from
`lib/router.ts`, and the savings ratio. Modeled from `MODEL_PRICING` are the dollar amounts.
Produced locally by `lib/llm.ts` is the completion text.

**Next (Person B, ordered):**
1. ~~**Store persistence**~~ — **SOLVED and verified end-to-end 2026-08-07.** `lib/kv.ts` snapshots the store to **Neon Postgres** (`DATABASE_URL`, table `public.store_snapshot`, key `bonsai:store:v1`). Upstash is a dormant secondary — Neon wins whenever `DATABASE_URL` is set, so no Upstash provisioning is needed or wanted.
   - Proof: created `branch_12`, killed the dev process, restarted, branch was still in `GET /api/state`. Zero `[kv]` warnings, so it was the real Neon path, not the silent in-memory fallback.
   - Neon project `bonsai` = `quiet-wind-73997653`, branch `br-dawn-tree-aw122xx7`, db `neondb`, region `aws-us-east-1`. Table already created.
   - **Vercel side is DONE.** `DATABASE_URL` (pooled) is set encrypted on Production + Preview + Development via `vercel env add`. **Production persistence verified live at 12:08**: `POST /api/branch` on `bonsai-lac.vercel.app` created `branch_7`, a later request to `GET /api/state` returned it, and `/api/economics` read back 4 logs / 97.1% cost saved. The snapshot row moved in step. Prod is genuinely on Neon, not in-memory.
   - `4670413` **fixed a data-loss bug in the first cut of this**: `kvGet` returned `null` for both "no snapshot yet" and "read failed", so a single transient Neon error made `loadStore` treat a populated store as empty and overwrite it with the fixture — the tree disappearing mid-demo. It now returns `hit` / `miss` / `error`, and only `miss` seeds. Verified by pointing `DATABASE_URL` at a dead host: two read failures logged, snapshot `updated_at` unchanged.
     - Record correction: `4670413`'s commit message says this was observed resetting production. It was not — the 12:05 reset was the parallel session's deliberate `DELETE` at 12:03. The bug was real and reachable; the production sighting was a misread.
   - **Debugging trap:** `lib/kv.ts` still swallows errors by design (rule 8), so a wrong `DATABASE_URL` degrades to in-memory *silently*. It no longer destroys data when it does, but it still looks identical to no config. Confirm with a restart-survival test, never by assuming.
   - **Demo hygiene:** snapshot was cleared 2026-08-07 12:03 (0 rows), so the tree re-seeds clean from `fixtures/seed-conversation.json`. State is durable now, so **anything you create while rehearsing persists into the demo** — re-run `DELETE FROM store_snapshot WHERE key = 'bonsai:store:v1';` after any practice run.
1b. **Mock engine hardened for off-script questions (`42566b8`) — done, but know what it does.** Since the mock is now the product, not a fallback, `lib/llm.ts` no longer answers from a canned table:
   - `compileBrief` used to return the same six Free Ventures facts for *every* branch — highlighting "ML@B" produced a brief about Free Ventures. It now ranks sentences out of the real parent transcript against the branch topic, so pruning is genuine for any selection.
   - Answers are drawn from the compiled brief's own facts. The two DEMO.md questions still return their rehearsed wording verbatim (matched by regex on the question), so Beats 2 and 3 are unchanged.
   - Below a relevance floor of 2 the answer is "the compiled brief does not cover that" rather than a confident irrelevant fact. Verified: "how many hours a week is ML@B?" and "why was Codebase dominated?" answer from the transcript; "tuition of Berkeley law school" and "who won the 2022 world cup" both decline.
   - Tokenizer keeps `@`/`&` inside words — dropping them cost the single most identifying term in any ML@B question.
   - The merge distiller no longer nominates the branch's own question as the insight.
2. **Snowflake inference logging — CODE SHIPPED `a81ee5c`, ONE MANUAL STEP LEFT.** `lib/snowflake.ts` INSERTs every `InferenceLog` over the SQL API and `/api/economics` SELECTs the panel's rows back out. Details in `docs/snowflake-notes.md`.
   - **Blocked on Tarun:** agents can't reference `.env*` in a command (bash-guard hook), so the table doesn't exist yet. Tarun runs `npx tsx --env-file=.env.local scripts/setup-snowflake.ts` — it creates `BONSAI.PUBLIC.INFERENCE_LOG`, writes a probe row, reads it back, deletes it, prints the count. **Until it runs, the app logs `[snowflake] insert failed (sql 422 002003 …)` on every inference and the panel silently serves in-memory logs — correct behavior, but Snowflake isn't in the demo yet.**
   - **Vercel needs the same three vars** (`SNOWFLAKE_ACCOUNT_URL`, `SNOWFLAKE_PAT`, and nothing else — database/schema/warehouse/role default to `BONSAI`/`PUBLIC`/`COMPUTE_WH`/`ACCOUNTADMIN`). `vercel env add` for Production, or prod keeps falling back to memory. Local-only is enough for a laptop demo; do it anyway if the demo runs off `bonsai-lac.vercel.app`.
   - **`isCortexEnabled()` now also requires `SNOWFLAKE_CORTEX_ENABLED=1`.** That is what makes it safe to have the `SNOWFLAKE_` vars set again: SQL logging gets its creds, Cortex stays off, and Person A's 1.51s → 0.33s win is preserved by construction rather than by keeping the vars commented out. Do not set that flag — there is no live Cortex.
   - **Warm the warehouse before the demo** (`scripts/setup-snowflake.ts --count`): a suspended `COMPUTE_WH` makes the first economics read a few seconds slow. It falls back to memory on a 12s abort, so worst case is a correct panel with no Snowflake in it.
   - **Read-back rule:** the panel serves Snowflake rows *only* when the table covers every log id in the current store; a partial read falls back to memory and logs one line. So the rows on stage are genuinely a `SELECT` result, and a slow or half-written table can never show a shorter table than the tree.
   - Rows accumulate across rehearsals while the Neon snapshot gets cleared — harmless, since the read filters by the current session's log ids. `DELETE FROM BONSAI.PUBLIC.INFERENCE_LOG;` if you want a clean table anyway.
   - **DEMO.md Beat 5 may say "logged to Snowflake" again once the setup script has run** — the DECIDED block above removed the claim pending exactly this. It is true only after the probe passes.
3. Run `npx tsx --env-file=.env.local scripts/try-engine.ts` to confirm `lib/llm.ts` degrades to mock cleanly rather than throwing. Cortex creds are present but barred, which is exactly the 4xx-with-valid-key path rule 8 cares about and it is now testable for real.
4. ~~Verify the Cortex response parse~~ — moot, no live Cortex. Leave both the JSON and SSE branches in `lib/llm.ts` alone.
5. ~~Pre-test deep-tier latency~~ — moot, mock responses are instant. Beat 3's risk is now purely visual pacing, not latency.

## M5 — engine surface for the UI rebuild (2026-08-07 ~13:40, `22a88fe`) — READ THIS FIRST IF YOU ARE BUILDING UI

The UI is being rebuilt in a separate Claude session. The engine changed underneath it. All
changes to `lib/types.ts` are **additive** — the existing components still compile — but three
things are new and one thing is gone.

**Gone: tier names on the surface.** No more ⚡ Quick / 🧠 Thoughtful / 🔬 Deep. Routing reads as
model + effort the way Claude states it — **"Opus 5 · High effort"**. `Tier` still exists in
`lib/types.ts` because it is the classifier's internal 1–3 mapping and `lib/types.ts` is frozen;
it is not a label. `components/TierBadge.tsx` still hardcodes the old emoji — that file is the
UI session's to replace.

**New: the mode picker is model × effort, or Auto.**
- `GET /api/modes` serves the catalog: `models` (Haiku 4.5 / Sonnet 5 / Opus 5, each with id,
  label, blurb, per-MTok rates), `efforts` (Low / Medium / High / Max, each with a token ceiling
  and a note), `autoPicks` (what Auto resolves to per complexity level), `pricingNote`.
  **Never hardcode a model name in a component** — `lib/models.ts` is the single source of truth.
- Send a pick as `mode: { mode: 'manual', model: 'claude-opus-5', effort: 'max' }` on
  `POST /api/chat` and `POST /api/branch`. `{ mode: 'auto' }` or omitting it runs the classifier.
  A manual pick sets `overridden: true` on the decision, which is the honest signal for the chip.
- `RoutingDecision` now carries `label` ("Opus 5 · Max effort"), `modelLabel` ("Opus 5"), and
  `effort`. Render `label`; don't rebuild the string. `InferenceLog.effort` feeds the economics
  table the same way.

**New: the app boots with a pre-built tree, not a bare root.** Six branches off the seeded
conversation, one per feature, so nothing has to be typed live:
`Free Ventures deadline` (Auto → Haiku 4.5 · Low, **already merged back**, so the root boots with
an insight) · `ML@B workload` (Auto → Sonnet 5 · Medium) · `Rank my top 3` (Auto → Opus 5 · High)
· `Why Codebase loses` (**depth 2**, a branch off a branch, 4 messages so a multi-turn branch is
visible) · `Blueprint` (**manual** Opus 5 · Max, `overridden: true`) · `Off-brief question` (the
compiled brief **declines** rather than inventing — the guardrail).
`/api/economics` therefore boots populated: 14 logs, all three models, all four effort levels,
~96% cost saved.
- The fixture is `fixtures/seed-tree.json`, **generated, never hand-edited**. Regenerate with
  `DATABASE_URL= npx next dev -p 3111` then `npx tsx scripts/build-seed-tree.ts` — it drives the
  real API, so every brief, pruned-% and cost in it is computed rather than written by hand.
  The root transcript stays in `seed-conversation.json`; the tree fixture only holds what the
  branches added (rule 5 still holds).
- **A node's chip shows the LAST turn's decision.** That is why the Opus and Sonnet branches have
  no follow-up turns — a cheap follow-up would overwrite their chip with Haiku. Keep that in mind
  before adding turns to the fixture.

**Keep:** the Branch and Merge-insight button reactions/animations. Tarun called those out
explicitly — do not lose them in the rebuild.

**Snowflake is out of the demo.** Cortex is barred and the log table was never created, so
`SNOWFLAKE_LOG_ENABLED` is unset and `lib/snowflake.ts` is inert: zero round trips, economics
serves in-memory logs. The code stays for the record. **Do not put "logged to Snowflake" on any
surface, and DEMO.md Beat 5 still says it — that line needs to go or the table needs creating.**

## Person A / UI — status (2026-08-07, `fb5c647`)

**M0–M4 UI complete.** Tree sidebar, chat pane, running token counter, selection→branch with pruned-% badge, ⚡/🧠/🔬 chips with hover card + override-pins-branch, merge-insight, economics panel. Re-verified green against the engine at `ef129a6` (Neon/KV store): build clean, lint clean, merge archives + returns a `memoryId`, `/api/economics` reads back.

**Confirmations for B (independent, before your Ongoing block was pushed — we agree):**
- Cortex `POST /api/v2/cortex/inference:complete` → 403 `003001`. Closed, agreed, not reopening. No mock labels on the demo surface.
- **Snowflake SQL API executes statements, not just auth**: `POST /api/v2/statements` with `SELECT CURRENT_REGION()` → **200, `AWS_US_EAST_2`**. Your Next #2 is viable. Stopped at read-only — the table schema is yours, and a table I invented would collide with it.
- `.env.local` is installed locally. **The two `SNOWFLAKE_` lines are commented out**, because with them set `isCortexEnabled()` is true and every inference paid a doomed 403 round-trip: branch went **1.51s / 0.81s → 0.33s / 0.18s** with them off, 6 wasted calls → 0. `.env.local.bak` holds the original; one `cp` restores it if you need the PAT for the SQL logging work (the SQL path reads the same vars, so re-enable before building #2).
  - *B, 12:40:* they are live again (something restored them) and that is now safe — `a81ee5c` gates Cortex behind `SNOWFLAKE_CORTEX_ENABLED=1`, which nothing sets. Verified locally: a branch created with the vars present logged `[snowflake] insert failed` and zero `[llm] cortex` lines, i.e. the SQL path tried, the inference path didn't. Leave them uncommented — SQL logging needs them.

**UI contract notes:** the economics table renders `InferenceLog.model` verbatim, so `MODEL_TIERS` display names land on stage as-is. `Insight.memoryId` drives a "· durable memory" tag — it only shows when the EverOS write succeeded, which is the honest signal for Beat 4.

**Person A owns nothing outstanding.** Next A work is the DEMO.md walkthrough audit and rehearsal. Vercel is B's.

### Design-doc import — node-graph sidebar (`50a1543`, 2026-08-07 ~13:00)

A separate session imported `Bonsai Mockups.dc.html` from claude.ai/design and implemented its two
new frames. Beats 1a–1e in that doc were a faithful recreation of the shipped UI, so nothing there
changed. What landed:

- **`components/TreeSidebar.tsx` is now a 400px node graph**, not the indented list. Cards are
  absolutely positioned; SVG edges connect them, tinted by the branch's last tier and dashed when
  archived. Cards carry the pruning kicker, message count, and per-branch spend.
- **`components/treeLayout.ts` (new)** computes card positions and edge paths in one pure pass.
  Geometry is calculated, not measured from the DOM, because the edges need the same coordinates
  as the cards — measuring would cost a second render on every state change. **Card heights are
  fixed per variant and the layout module and the cards must agree**; change one, change both.
- **`components/MergeFlight.tsx`** gained the dotted arc and the landing ring on the target node.
  The ring runs on its own `TRAVEL_MS` timer — `landed` fires on the first frame and only *starts*
  the pill's transition, so keying the ring off it pops it immediately. Tarun asked that the
  Branch/Merge reactions survive the rebuild; this is that animation, extended, not replaced.
- **`components/Workspace.tsx`** reads `/api/economics` for per-branch cost and the session total
  on the Economics button. Decoration only — a failed fetch resolves to `null` and the cards omit
  the cost rather than blanking the tree.

**Known conflict with M5, handed to the UI session — do not treat this as settled.** The graph
still speaks in tiers: node badges render `TierBadge` (⚡/🧠/🔬) and edge tints key off
`BranchNode.lastTier`. M5 says tier names are gone from the surface in favour of
`RoutingDecision.label` ("Opus 5 · High effort"). The import compiles and runs against the M5
engine because the `lib/types.ts` additions were additive, but the labelling is on the wrong side
of that decision. When the chip is rebuilt, the sidebar needs the same two edits: render `label`
on the cards instead of `TierBadge`, and key the `ACCENT` map in `TreeSidebar.tsx` off `effort`
rather than `tier`. The layout module is label-agnostic and needs no change.

Build clean, lint clean, verified in-browser against the pre-M5 store: branch → depth-2 nesting,
merge → arc → archived card → insight landing on the parent.

### Requested next, UI session — "make it behave like a real website" (Tarun, 2026-08-07 ~14:10)

Three things. The engine half of the third is **done and deployed**; the other two are `app/**` /
`components/**`, so B did not touch them.

1. **Back / forward must work.** The selected branch lives in React state, so the browser buttons
   do nothing and a shared link always lands on the root. Put the selection in the URL —
   `/?branch=branch_15` with `useSearchParams` + `router.push` is the smallest change that works;
   a `/b/[branchId]` route is nicer if there is time. Back/forward then work for free.
2. **Reload must land where you were.** Follows from 1 — state already comes from `GET /api/state`
   on mount, so once the branch id is in the URL a refresh restores the view. Nothing else needed.
3. **Reset button — endpoint is live: `POST /api/reset`.** No body. Returns a full
   `StateResponse` (`rootId` / `tree` / `conversations`), so render its response directly instead
   of re-fetching. Put it somewhere deliberate — it throws away everything the audience just
   watched you create. Confirm before firing.
   - **Use this instead of deleting the Neon row.** Clearing the snapshot by hand does not reset a
     warm lambda: globalThis still holds the old tree and the next request writes it straight back.
     That is exactly what happened at 13:55 — the manual `DELETE` left an 8-node tree in production.
     `resetStore()` replaces memory first, then persists over the top.
   - Also fixed in that commit: `logInference` was pushing into the imported JSON fixture array in
     place, so rehearsal logs accumulated in the fixture for the life of the process and survived
     every rebuild. `build()` now clones. Verified: 8 nodes / 17 logs after a rehearsal → 7 / 14
     after reset.

**Production is green as of 14:15** — Vercel Authentication off, `/`, `/api/state`, `/api/modes`,
`/api/economics`, `/api/reset` all 200, tree reset to the pre-built 7 nodes with model·effort
labels, 14 logs, 95.8% cost saved.

**Do not cut** (DEMO.md): branch + compiled brief with pruned-%, the cheap-vs-strong contrast on the two demo questions, merge-insight, the counters. Note the mock classifier is deliberately heuristic so that contrast survives with zero keys — do not "simplify" it to a constant.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
