# EverMind EverOS — working notes (verify against saved official docs)

*Written from public docs as of Aug 6, 2026. Treat `docs/evermind-official-*.md` (saved tonight) as authoritative; do not invent endpoints beyond what's documented there.*

> **⚠️ Corrected Aug 7: the "v1" guidance below is wrong.** The official reference now
> describes a unified **v2** API (`/api/v2/memory/*`) and calls v1 "legacy, kept for
> compatibility." Build against v2 — see **`evermind-official-v2.md`**, which has the
> verified endpoint contracts, the four gotchas, and a timing trap that affects DEMO.md
> Beat 4. The rest of this file (how Bonsai uses memory, pitch framing) still stands.

## What it is, in Bonsai terms

EverOS is EverMind's memory layer: it ingests conversations/messages and turns them into structured, retrievable long-term memory. Memory comes in types (episodes, profile facts, atomic facts, plus knowledge documents) and in scopes (user memory, group memory, agent memory). Two ways to run it:

1. **Cloud REST API (use this):** hosted **v2** API at `https://api.evermind.ai`. Auth = `Authorization: Bearer <EVERMIND_API_KEY>`, key from everos.evermind.ai. **Corrected Aug 7 from the official docs: use `/api/v2/memory/*`; v1 is legacy, kept only for backward compatibility.** Endpoints, request shapes and response shapes are in `docs/evermind-official-v2.md` — that file is authoritative, this one is orientation.
2. Local open-source server (`pip install everos`, `everos server start`) — backup only if cloud/wifi fails at the venue; it stores memory as local Markdown/SQLite. Python 3.12. Don't burn time here unless forced.

There's also a Python SDK (`pip install everos-cloud`), but our stack is TypeScript — call REST directly from `lib/memory.ts`.

## How Bonsai uses it (the whole integration, keep it this small)

- **Write** on two events: (1) merge-insight → store the distilled Insight line as a memory attributed to the user; (2) branch creation → optionally store an episode marker ("user branched to explore X").
- **Read** inside `compileBrief`: search memories relevant to the branch topic; feed the top hits into the brief alongside parent-conversation facts.
- Messages sent for ingestion follow a simple message format (id, timestamp, sender, content) — mirror our `Message` type when mapping.
- Every call wrapped in try/catch → on failure, `data/memory.json` fallback, one-line log, keep going.

## Pitch-relevant facts

- EverMind's whole thesis is persistent memory as the core of the agent stack — Bonsai's merge-to-memory and memory-informed briefs are a native use, not a bolt-on. Say "durable memory via EverOS" on stage.
- Memory scopes (user/group/agent) map cleanly to a future Bonsai story: user memories power briefs today; agent memories could hold the router's learned patterns later. One sentence of roadmap, zero code.

## Bonsai's actual calls (implemented in `lib/memory.ts`)

- **Write** (`writeInsight`) → `POST /api/v2/memory/add` with `async_mode: false`, then `POST /api/v2/memory/flush` to force extraction immediately. The demo cannot wait on the async queue.
- **Read** (`searchMemories`) → `POST /api/v2/memory/search`, `method: "hybrid"`, `top_k: 5`, `include_profile: true`.
- Scope is `user_id` (mutually exclusive with `agent_id`). `session_id` = our branch id.
- `timestamp` is Unix **milliseconds** and has no default over HTTP — always send it.

## Open items

- ~~Exact endpoint paths + request bodies~~ → done, `docs/evermind-official-v2.md`.
- Whether the hackathon provides event keys/credits (ask at sponsor hour; swap into `.env.local`).
- Confirm the account is enabled for v2 — a 403 `VERSION_NOT_ALLOWED` means it is not, and we fall back to local memory.
