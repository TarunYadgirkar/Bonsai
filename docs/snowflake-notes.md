# Snowflake Cortex — working notes (verify against saved official docs)

> ## ⛔ STATUS 2026-08-07: CORTEX IS UNAVAILABLE ON OUR ACCOUNT — CONFIRMED WITH ORGANIZERS
>
> Everything below about *calling models* is *reference only*. Do not implement against it, and do not
> spend time debugging it. Account `RGZOHDN-KQ65280` is barred on both surfaces:
> REST `POST /api/v2/cortex/inference:complete` → `003001` "This account is not allowed to access this
> endpoint"; SQL `AI_COMPLETE(...)` → "not available for trial accounts". Model names, request shapes,
> and `CORTEX_ENABLED_CROSS_REGION` were all ruled out. `lib/llm.ts` ships in mock mode. See the
> **Ongoing → CLOSED** section of `AGENTS.md` before touching any of this.
>
> **Still true and still useful:** the Snowflake **SQL API** works on the same PAT
> (`GET /api/v2/databases` → 200). The "Economics logging" section below is therefore live work,
> not a stretch goal — it is now the only path by which the demo genuinely touches Snowflake.
>
> Note also that `docs/snowflake-official-*.md`, referenced below as authoritative, **was never saved**.
> Only `evermind-official-v2.md` exists. Treat the request shapes below as unverified.

*Working notes as of Aug 6, 2026. Treat `docs/snowflake-official-*.md` (saved tonight) as authoritative — especially exact request shapes and currently-available model names, which change often. Do not invent parameters.*

## Why Snowflake is load-bearing for Bonsai

Cortex exposes **many models behind one API with per-request model selection** — exactly the substrate a router needs. `lib/llm.ts` = one client, `model` as a parameter, and our router just changes the string. Billing is token-based per model, which is also our cost-accounting source.

## Two ways to call it

1. **REST (use this from Next.js):** `POST {SNOWFLAKE_ACCOUNT_URL}/api/v2/cortex/inference:complete` with a JSON body: model + chat-style messages (and optional params like temperature/max_tokens). Auth via `Authorization: Bearer` using a programmatic access token (simplest for a hackathon) or key-pair JWT. Response includes the completion and token usage — capture usage into `InferenceLog` on every call.
2. SQL function (`AI_COMPLETE`, formerly `SNOWFLAKE.CORTEX.COMPLETE`) — handy in a worksheet for sanity checks and for showing "it's really Snowflake" if an engineer asks; not our app path.

## Model tiers (fill exact names tonight from the AI_COMPLETE docs page — availability varies by region/account)

- quick → smallest/cheapest available (small Llama-class or similar)
- thoughtful → mid model
- deep → strongest available (large Claude/Mistral/Llama-class)
Put the three chosen names in one place: `lib/llm.ts` `MODEL_TIERS` const. Internal calls (classifier, compiler, merge-distiller) always use the quick tier.

## Economics logging — SHIPPED, this is the live Snowflake path

`lib/snowflake.ts` mirrors every `InferenceLog` into a Snowflake table over the SQL API, and
`/api/economics` reads the panel's rows back out with a `SELECT`. Both degrade silently to the
local `data/inference-log.json` / in-memory logs when the SQL API is unreachable (rule 8).

- Endpoint: `POST {SNOWFLAKE_ACCOUNT_URL}/api/v2/statements`, `Authorization: Bearer $SNOWFLAKE_PAT`
  plus `X-Snowflake-Authorization-Token-Type: PROGRAMMATIC_ACCESS_TOKEN` (the header is optional per
  the PAT docs; sent explicitly so the auth mode is never guessed).
- Body: `{statement, timeout, database, schema, warehouse, role, bindings}`. Bind values are **all
  `TEXT`** and cast in SQL (`?::NUMBER`, `?::BOOLEAN`); Snowflake's binding type names vary per
  column type and a wrong one is a 422, so one type plus explicit casts can't drift.
- Every value in a response `data` array is a string, including numbers and booleans — `toLog()`
  converts.
- Table `BONSAI.PUBLIC.INFERENCE_LOG` (override with `SNOWFLAKE_DATABASE` / `SNOWFLAKE_SCHEMA` /
  `SNOWFLAKE_LOG_TABLE`), one row per inference plus a `logged_at TIMESTAMP_LTZ` default.
  `ts` is stored as the raw ISO string so the round trip is lossless; `logged_at` is the real
  timestamp for ordering and for a judge poking at the table in a worksheet.
- Setup + round-trip proof: `npx tsx --env-file=.env.local scripts/setup-snowflake.ts`
  (`--count` reports rows without writing, `--keep` leaves the probe row behind).
- DDL runs in the setup script, never per request — a `CREATE TABLE IF NOT EXISTS` on the demo path
  buys latency and nothing else.

**`/api/economics` only serves Snowflake rows when the table covers every log id in the current
store.** A partial read falls back to memory, because a short table on stage looks like lost data.

## Gotchas

- Trial accounts: make sure the account/region actually has the models you pick — test at 10:15 AM with the scratch-session prompt.
- Latency on big models is real; the deep-tier demo question should be pre-tested so you know it returns within demo patience (~10s). If slow, stream or show the routing card while it thinks — the card IS the product.
- Never call Cortex from client components; server routes only (keys stay server-side).
