# EverOS v2 — verified API reference

*Source: https://docs.evermind.ai/llms-full.txt, fetched Aug 7 2026. Endpoint shapes below
are copied from that reference, not remembered. `add` was verified live against our key
(HTTP 200); `flush` and `search` are documented-but-unverified — see Status at the bottom.*

**This supersedes the v1 guidance in `evermind-notes.md`.** That file says "hosted v1 API …
use only `/api/v1/...` endpoints". The official reference now says the opposite: the
**unified v2 API (`/api/v2/memory/*`)** is current and shared by Cloud and self-hosted, and
"the v1 Cloud and v1 OSS APIs are legacy, kept for compatibility." Build against v2.

## Basics

- Base URL: `https://api.evermind.ai` · Auth header: `Authorization: Bearer <key>`
- Every response is an envelope: `{"request_id": "...", "data": { ... }}` — unwrap `.data`.
- `app_id` / `project_id` (both default `"default"`) partition memory; queries never cross scopes.
- HTTP-first, any language. **The Python SDK (`pip install everos-cloud`) is optional
  convenience only** — Bonsai calls REST with `fetch` from `lib/memory.ts`. A Python
  dependency can't run inside a Next.js route handler on Vercel.

## The four gotchas that will bite

1. **`timestamp` is unix _milliseconds_ and is required over HTTP.** Omitting it returns
   `400 InvalidParameter` on `messages[i].timestamp`. The Python SDK stamps it for you,
   which is why SDK examples show messages without one — REST examples are not the same.
2. **No top-level `user_id` on `add`.** Attribution is per-message via `sender_id`.
   Each message needs all four of `sender_id`, `role`, `timestamp`, `content`.
3. **`search` and `get` require exactly one of `user_id` / `agent_id`.** Sending neither
   (or both) is a `422 invalid_argument`.
4. **Writes are asynchronous by default.** `add` returns `202 {"status":"queued"}`.

## Endpoints Bonsai needs

### `POST /api/v2/memory/add`

Body: `session_id` (1–128 chars), `messages[]` (1–500), optional `async_mode`, `mode`
(`chat` | `agent`), `app_id`, `project_id`.

```jsonc
{"session_id":"branch_free_ventures","async_mode":false,
 "messages":[{"sender_id":"bonsai_tarun","role":"user","timestamp":1754590000000,
              "content":"Free Ventures applications close September 11."}]}
```

Returns `{"message_count":N,"status":...}` — `"queued"` (202, async) or, synchronously
(200), `"accumulated"` **or** `"extracted"`. See the timing trap below: `"accumulated"`
does *not* mean searchable.

### `POST /api/v2/memory/flush`

Body: `session_id` (required), optional `app_id` / `project_id`. Runs boundary detection on
accumulated messages and extracts immediately if a boundary is found.
Returns `{"status":"extracted"}` or `{"status":"no_extraction"}`.

### `POST /api/v2/memory/search`

Body: `query` + exactly one of `user_id`/`agent_id`; optional `method`
(`keyword`|`vector`|`hybrid`|`agentic`, default `hybrid`), `top_k`, `include_profile`,
`min_score`, `radius`, `filters`.

Returns `{episodes[], profiles[], agent_cases[], agent_skills[], unprocessed_messages[]}`.
An episode carries `summary`, `subject`, `episode` (full narrative — this is the field to
paste into a prompt), `atomic_facts[]`, and `score`.

Method choice: `hybrid` at `top_k` 5 (chat) / 10 (research) is the default. `agentic` costs
3–5× more and is ~10× slower (2–5s) — not worth it on stage. `keyword` is <100ms.

### `POST /api/v2/memory/get`

Body: `memory_type` (`episode`|`profile`|`agent_case`|`agent_skill`) + exactly one of
`user_id`/`agent_id`. `{"memory_type":"profile","user_id":"..."}` returns `profile_data`,
a dict of learned user attributes.

## ⚠️ The timing trap — read this before wiring Beat 4

DEMO.md Beat 4 merges an insight and says it "gets written to durable memory." If we write
and then read it back on stage, **extraction is asynchronous and a fresh write is not
immediately searchable.** Our live `add` with `async_mode:false` returned `"accumulated"`,
not `"extracted"` — the messages were buffered, with no episode formed yet. A `search`
issued right then would not have found an episode.

Three mitigations, cheapest first:

1. `add` with `"async_mode": false`, then **`POST /flush`**, then search. Still not a
   guarantee — flush returns `"no_extraction"` when no semantic boundary is detected, and
   two short messages may not form one.
2. **Read the in-flight buffer.** `search` returns `unprocessed_messages[]` — the raw,
   not-yet-extracted tail. It only populates when the request pins exactly one session as a
   **top-level scalar** filter: `"filters": {"session_id": "..."}`. Wrapping it in `AND`/`OR`,
   nesting it, or writing it as an operator map (`{"eq": ...}`) all silently yield `[]`.
   Scoping by `user_id` alone is not enough — buffered rows have no owner attribution yet.
3. **Don't make the demo depend on the round-trip.** Per AGENTS.md rule 8 and DEMO.md's own
   fallback ("If EverMind is down → memory writes go to the local store, say 'durable memory
   layer' and move on"), the merge should write to EverOS *and* `data/memory.json`, and the
   UI should render from the local store. The write is real; the read never blocks the stage.

Recommendation: do (1) + (3). Treat (2) as the nice-to-have if there's time after M4.

## Endpoints Bonsai does not use (recorded so nobody re-derives them)

- `POST /api/v2/memory/edit` — bulk profile edit, cloud only. `user_id` + `operations[]` (1–50);
  operation = `action` (`add`|`update`|`delete`), `type` (`explicit_info`|`implicit_traits`),
  `data`, `item_id`, `reason`. Returns `{user_id, version, applied, results[]}`.
- `POST /api/v2/memory/delete` — soft delete, cloud only. Any combination of
  `user_id` / `agent_id` / `session_id`. Returns `{filters[], count}`.
- `POST /api/v2/object/sign` — presign multimodal uploads. 3-step S3 flow; not our path.

Field signatures by `memory_type`: **episode** → `summary`, `subject`, `episode`,
`atomic_facts[]`, `sender_ids[]`, `timestamp` · **profile** → `profile_data` ·
**agent_case** → `task_intent`, `approach`, `quality_score`, `key_insight` ·
**agent_skill** → `name`, `description`, `content`, `confidence`, `maturity_score`,
`source_case_ids[]`. `get` also returns `total_count` / `count`; paging is `page` /
`page_size` (default 1 / 20, max 100).

## Filters DSL

Recursive `AND` / `OR` over scalar conditions. Supported fields: `user_id`/`agent_id`
(`eq`, `in`), `session_id` (`eq`, `in`, `gt`, `gte`, `lt`, `lte`), `timestamp`
(`eq`, `gt`, `gte`, `lt`, `lte`). A plain value means equality.

```jsonc
{"AND": [{"timestamp": {"gte": 1700000000000}}, {"session_id": "s1"}]}
```

**But note the exception in the timing trap above:** to read `unprocessed_messages[]` the
`session_id` must be a bare top-level scalar (`{"session_id": "..."}`), *not* wrapped in
`AND`/`OR` and *not* an operator map.

## Errors

| HTTP | Meaning |
|---|---|
| 401 | Missing / invalid token |
| 403 | `VERSION_NOT_ALLOWED` — account is on v1 and may not call v2 |
| 422 | Validation, e.g. bad ms timestamp, or missing `user_id`/`agent_id` |
| 429 | Rate limit / quota |

Our key returns 200 on v2, so the account is provisioned for v2 — no 403 risk.

## Status

| Call | Verified? |
|---|---|
| `add` (`async_mode:false`) | ✅ live, HTTP 200, `{"message_count":2,"status":"accumulated"}` |
| `flush` | ❌ not run — sandbox blocked the request |
| `search` | ❌ not run — sandbox blocked the request |

Auth, base URL, envelope shape, and the v2 entitlement are therefore confirmed. The
`flush`→`search` read path is documented but unproven; **prove it before relying on it in
Beat 4.** Test session id `bonsai_smoke_001`, sender/user id `bonsai_tarun`.

## Env var naming — decided

`EVERMIND_API_KEY` is canonical (it is what `.env.example` declares). `lib/memory.ts` also
reads `EVEROS_API_KEY` as a fallback, so a key exported under EverOS's own name still works
and nobody loses a demo to a variable-name mismatch.

## What `lib/memory.ts` implements (B, done)

- `writeInsight` → `add` with `async_mode:false`, then `flush`. Always mirrors to
  `data/memory.json` regardless of the remote result — mitigation (1) + (3).
- `searchMemories` → `search` with `method:"hybrid"`, `top_k:5`, `include_profile:true`;
  pass `sessionId` to add the top-level scalar `filters` and merge `unprocessed_messages[]`
  into the hits — mitigation (2), implemented since it was ~10 lines.
- Any non-2xx or timeout (8s) logs one line and falls through to the local store.

Still unproven: the live `flush` → `search` round-trip. Run
`npx tsx --env-file=.env.local scripts/try-memory.ts` to prove it.
