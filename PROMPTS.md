# PROMPTS.md — Claude Code session prompts

## Session strategy (read once)

**Two primary sessions, one per person, all day.** Person A's session lives in the repo and only touches A's territory; same for B. With both of you on Max 20x, quota won't be the constraint at 5 hours — repo coherence is. More parallel agents on one small repo = merge conflicts and drift, not speed.

- Run `/clear` at every milestone boundary. CLAUDE.md → AGENTS.md → PLAN.md re-anchor the agent instantly; stale context from the last milestone just pollutes the next one.
- **Optional third session (Person B, before 11 AM):** a scratch directory *outside* the repo to verify Snowflake + EverMind auth with tiny curl/scripts. Throw it away after. Never point two sessions at the repo per person.
- One milestone per prompt. Never "build the whole thing" — that's 45 minutes of unreviewed code that's structurally wrong in a way you find at hour three, with no rollback point.
- Occasional Codex use is fine — it reads AGENTS.md natively, so the same rules apply. Same territory discipline.

---

## Person B, pre-event scratch session (~10:15 AM, outside the repo)

> Create a scratch folder. Two tasks, nothing fancy: (1) Using the Snowflake account in my env vars (SNOWFLAKE_ACCOUNT_URL, SNOWFLAKE_PAT), make one successful REST call to Cortex `AI_COMPLETE` (`/api/v2/cortex/inference:complete`) with model `claude-haiku` or any cheap available model, prompt "say ok", and print the response + token usage. (2) Using EVERMIND_API_KEY, hit the EverOS v1 API: add one memory, then search it back, print both responses. Consult the API notes in ~/TarunsCode/bonsai/docs/ if present; if a call fails, show me the exact request and error — do not invent endpoints. Stop when both round-trips print.

## Person A — M0 kickoff (11:00, empty repo dir)

> Read CLAUDE.md, then PLAN.md milestone M0 and DEMO.md. Scaffold this repo: create-next-app with TypeScript, Tailwind, App Router, ESLint. Add the folder structure from AGENTS.md (app/, components/, lib/, fixtures/, scripts/, docs/ — keep the existing md files and fixtures at root). Make the home page render "Bonsai" and the seed conversation title from fixtures/seed-conversation.json. Run `npm run build`, fix errors, commit "M0: scaffold". Then print the exact steps for me to connect this repo to Vercel. Do not start M1.

## Person B — M0 contracts (11:10, after A pushes)

> Read CLAUDE.md, PLAN.md milestone M0, and PRODUCT.md. Create `lib/types.ts` with the contracts listed in PLAN.md M0 (Conversation, Message, BranchNode, ContextBrief, RoutingDecision, InferenceLog, Insight) and stub API routes `app/api/chat`, `app/api/branch`, `app/api/merge`, `app/api/economics` that return typed mock data. Create `.env.local` from `.env.example` (I'll fill values). Build, fix, commit "M0: contracts + stubs". Do not implement real logic yet.

## Person A — M1 (11:30)

> /clear first. Read CLAUDE.md, PLAN.md M1 (Person A scope only), DEMO.md. Build the two-pane layout: tree sidebar + chat pane, loading fixtures/seed-conversation.json through GET on the mock API. Show a running input-token counter for the open conversation. Keep the tree simple (indented list is fine for now). Everything through the /api routes — never import lib/ engine code directly into components. Build, fix, commit "M1: walking skeleton UI". Stay out of lib/ and app/api implementations — Person B owns those.

## Person B — M1 (11:30)

> /clear first. Read CLAUDE.md, PLAN.md M1 (Person B scope only), docs/snowflake-notes.md, PRODUCT.md sections on branching and context compilation. Implement `lib/llm.ts`: a `complete({model, messages, effort})` wrapper over Snowflake Cortex AI_COMPLETE via REST, returning text + input/output token counts + estimated cost; if SNOWFLAKE env vars are missing, transparently use mock mode (canned responses, realistic token math). Then `lib/compiler.ts`: `compileBrief(parentMessages, selection)` → ContextBrief via one cheap LLM call — relevant facts only, resolve referents so the brief is self-contained, include an excludedNote. Add `scripts/try-engine.ts` that compiles briefs for the two DEMO.md questions and prints them. Build, fix, commit "M1: llm layer + compiler". Don't touch components/.

## Person A — M2 (1:00)

> /clear first. Read CLAUDE.md, PLAN.md M2 (A scope), DEMO.md Beats 2–3. Implement: text-selection → Branch button → POST /api/branch → new child node in the tree with a "pruned %" badge on the edge (from the mock ContextBrief). Each assistant response gets a routing chip (⚡ Quick / 🧠 Thoughtful / 🔬 Deep) with a hover card showing contextTokens, model, effortNote, estCostUsd, reason — all from the RoutingDecision in the API response. Chip click opens an override menu; the choice pins the branch (send pinnedTier on subsequent /api/chat calls). Build, fix, commit "M2: branch + chips UI".

## Person B — M2 (1:00)

> /clear first. Read CLAUDE.md, PLAN.md M2 (B scope), PRODUCT.md routing sections. Implement `lib/router.ts`: `route(brief, question, pinnedTier?)` → RoutingDecision. One cheap classifier call rates complexity 1–3 → tier → model/effort/context budget; respect pinnedTier by skipping classification; add a start-cheap-then-escalate path (if the cheap answer fails a one-line sanity check, retry one tier up and record the escalation in `reason`). Wire /api/chat to: compile (or reuse) brief → route → complete → log every inference (InferenceLog) to the store from AGENTS.md. Verify in scripts/try-engine.ts that the two DEMO.md questions route quick vs deep. Build, fix, commit "M2: router + logging".

## Integration — M3 (2:00, run in ONE session — Person A's — while B watches / handles env)

> /clear first. Read CLAUDE.md, PLAN.md M3, DEMO.md Beats 1–3. Swap the mock API implementations for the real engine in lib/ behind the same contracts — change as little UI code as possible. Wire `lib/memory.ts` per docs/evermind-notes.md: write a memory on merge and on branch creation, read relevant memories into compileBrief; on any EverMind failure, fall back silently to the local JSON store. Then run through DEMO.md Beats 1–3 against localhost and tell me exactly what you did and what the outputs were; fix what's broken. Build, fix, commit "M3: integrated". Then we redeploy and test on the Vercel URL ourselves.

## M4 (2:45 — A and B back in their own sessions)

Person A:
> /clear first. Read PLAN.md M4 (A scope), DEMO.md Beats 4–5. Implement the Merge insight button in a branch: POST /api/merge, show the returned one-line Insight visually flowing into the parent node, mark the branch archived. Build the economics panel: table of InferenceLogs (model, tier, contextTokens, cost) + session totals + the baseline comparison from /api/economics. Big clear numbers. Build, fix, commit "M4: merge + economics UI".

Person B:
> /clear first. Read PLAN.md M4 (B scope). Implement /api/merge: one small LLM call distills the branch into a single durable Insight line; append to parent state; write to memory layer. Implement /api/economics: return all logs + totals + baseline (for each logged request, what full parent history would have cost in input tokens at the same model) + strong-model-always cost comparison. Build, fix, commit "M4: merge + economics engine".

## Freeze (3:30 — no more feature prompts after this)

> /clear first. Read DEMO.md. Do a read-only audit: run the build, run scripts/try-engine.ts, and walk through each DEMO.md beat telling me which parts are real on the deployed URL and which would fail. Fix ONLY things that break the script — no refactors, no new features. Then stop.

Then: record the backup run, rehearse three times, submit.

## If something's on fire (any time)

> Read AGENTS.md. X is broken: [paste exact error/behavior]. Reproduce it, find the smallest fix that keeps the DEMO.md script working, apply it, build, commit. Do not refactor anything else.
