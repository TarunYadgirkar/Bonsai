# EverMind EverOS — working notes (verify against saved official docs)

*Written from public docs as of Aug 6, 2026. Treat `docs/evermind-official-*.md` (saved tonight) as authoritative; do not invent endpoints beyond what's documented there.*

## What it is, in Bonsai terms

EverOS is EverMind's memory layer: it ingests conversations/messages and turns them into structured, retrievable long-term memory. Memory comes in types (episodes, profile facts, atomic facts, plus knowledge documents) and in scopes (user memory, group memory, agent memory). Two ways to run it:

1. **Cloud REST API (use this):** hosted v1 API. Auth = `Authorization: Bearer <EVERMIND_API_KEY>`, key from everos.evermind.ai. Note: the v0 API is deprecated — use only `/api/v1/...` endpoints. REST reference lives at docs.evermind.ai (api.evermind.ai hosts the API).
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

## Open items (fill from official docs tonight)

- Exact v1 endpoint paths + request bodies for: add memory, search memory. → paste into `docs/evermind-official-api.md`.
- Whether the hackathon provides event keys/credits (ask at sponsor hour; swap into `.env.local`).
