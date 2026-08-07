# EverOS REST API — official reference

Fetched from https://docs.evermind.ai/llms-full.txt on Aug 7, 2026. **Authoritative.**
Do not invent endpoints or params beyond this file.

## Base URL & auth

- Cloud: `https://api.evermind.ai`
- Self-hosted: `http://127.0.0.1:8000`
- Header (cloud only): `Authorization: Bearer <api_key>`

All bodies JSON. Response envelope: `{"request_id": "...", "data": { ... }}`

**Use v2 (`/api/v2/memory/*`).** The v1 Cloud API is legacy, kept only for backward compatibility.

## POST /api/v2/memory/add

Ingest messages into a session for memory extraction.

| Field | Type | Notes |
|---|---|---|
| `session_id` | string, required | 1–128 chars |
| `messages` | array, required | 1–500 items |
| `async_mode` | boolean, optional | default `true` → 202 `"queued"`; `false` → 200 sync |
| `mode` | string, optional | `"chat"` (default) or `"agent"` |
| `app_id` / `project_id` | string, optional | both default `"default"` |

Message item — all four required:

| Field | Type | Notes |
|---|---|---|
| `sender_id` | string | participant identifier, used for attribution |
| `role` | string | `"user"` \| `"assistant"` \| `"tool"` |
| `timestamp` | integer | Unix **milliseconds**, ≥ 1000000000000. No default over HTTP. |
| `content` | string or array | text, or multimodal content items |

Optional: `sender_name`, `tool_calls[]`, `tool_call_id`.

Responses: async 202 `{"data": {"message_count": 2, "status": "queued"}}` · sync 200 `{"data": {"status": "accumulated" | "extracted"}}`

## POST /api/v2/memory/flush

Force boundary detection and immediate extraction for a session.

Request: `session_id` (required), `app_id` / `project_id` (optional).
Response: `{"data": {"status": "extracted" | "no_extraction"}}`

## POST /api/v2/memory/search

| Field | Type | Notes |
|---|---|---|
| `query` | string, required | |
| `user_id` **or** `agent_id` | string, required | exactly one — scopes to owner |
| `method` | string, optional | `"keyword"` \| `"vector"` \| `"hybrid"` (default) \| `"agentic"` |
| `top_k` | integer, optional | 5 chat / 10 research typical; `-1` = server auto-cutoff |
| `include_profile` | boolean, optional | default false |
| `min_score` | float, optional | 0.0–1.0 |
| `radius` | float, optional | vector similarity floor |
| `enable_llm_rerank` | boolean, optional | default false |
| `filters` | object, optional | Filters DSL |

Response `data`: `episodes[]`, `profiles[]`, `agent_cases[]`, `agent_skills[]`, `unprocessed_messages[]`.

Episode hit shape: `id`, `user_id`, `session_id`, `timestamp`, `sender_ids[]`, `summary`, `subject`, `episode`, `atomic_facts[{id, content}]`, `score`.

`unprocessed_messages` (raw not-yet-extracted buffer) only loads when `filters` pins a single `session_id` by top-level scalar equality. Raw messages carry no `score`.

## POST /api/v2/memory/get

Paginate/list one memory type.

| Field | Notes |
|---|---|
| `memory_type` | required: `"episode"` \| `"profile"` \| `"agent_case"` \| `"agent_skill"` |
| `user_id` **or** `agent_id` | required, exactly one |
| `page` / `page_size` | default 1 / 20, max 100 |
| `sort_by` / `sort_order` | `"timestamp"` (default) \| `"updated_at"` · `"desc"` (default) \| `"asc"` |
| `filters` | Filters DSL |

Response adds `total_count`, `count`.

Field signatures: **episode** → `summary`, `subject`, `episode`, `atomic_facts[]`, `sender_ids[]`, `timestamp` · **profile** → `profile_data` · **agent_case** → `task_intent`, `approach`, `quality_score`, `key_insight` · **agent_skill** → `name`, `description`, `content`, `confidence`, `maturity_score`, `source_case_ids[]`

## POST /api/v2/memory/edit  (cloud only)

`user_id` (required), `operations` (1–50). Operation: `action` (`add`|`update`|`delete`), `type` (`explicit_info`|`implicit_traits`), `data`, `item_id`, `reason`.
Response: `user_id`, `version`, `applied`, `results[{op_index, status, item_id}]`.

## POST /api/v2/memory/delete  (cloud only)

Soft-delete. Any combination of `user_id` / `agent_id` / `session_id`.
Response: `{"data": {"filters": [...], "count": 5}}`

## Filters DSL

Recursive `AND` / `OR` over scalar field conditions:

```json
{"AND": [
  {"timestamp": {"gte": 1700000000000, "lt": 1710000000000}},
  {"session_id": "s1"}
]}
```

Supported: `user_id`/`agent_id` (`eq`, `in`), `session_id` (`eq`, `in`, `gt`, `gte`, `lt`, `lte`), `timestamp` (`eq`, `gt`, `gte`, `lt`, `lte`). Plain value = equality.

## Scopes

`user_id` and `agent_id` are mutually exclusive. Queries never cross `app_id` / `project_id` partitions.

## Retrieval methods

| Method | Latency | Use |
|---|---|---|
| `keyword` | <100 ms | exact terms, IDs (BM25) |
| `vector` | 200–500 ms | semantic / paraphrased |
| `hybrid` | 200–600 ms | **default** (keyword + vector + RRF rerank) |
| `agentic` | 2–5 s | complex multi-part; 60 s timeout, fall back to hybrid on error |

## Errors

| HTTP | Scenario | Body |
|---|---|---|
| 401 | missing/invalid token | `{"error": {"code", "message"}}` |
| 403 | account not on v2, or permissions | `{"error": {"code": "VERSION_NOT_ALLOWED", ...}}` |
| 422 | validation | `{"code": "InvalidParameter", "message", "param"}` |
| 429 | rate limit / quota | gateway error body |

## Multimodal (not used by Bonsai)

`content` may be an array of items typed `image`/`text`/`audio`/`doc`/`pdf`/`html`/`email` with `uri` = `objectKey` from `POST /api/v2/object/sign` (3-step S3 upload). ≤10 non-text items per message, body <300 KB.
