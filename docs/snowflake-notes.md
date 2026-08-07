# Snowflake Cortex — working notes (verify against saved official docs)

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

## Economics logging

Simplest thing that works: append every inference (ts, branchId, tier, model, contextTokens, outputTokens, estCostUsd, escalated?, overridden?) to `data/inference-log.json`; `/api/economics` aggregates. If time allows (it's a stretch goal, see PLAN cut lines), mirror rows into a Snowflake table so the panel is literally "queried from Snowflake" — nice line on stage, zero product difference.

## Gotchas

- Trial accounts: make sure the account/region actually has the models you pick — test at 10:15 AM with the scratch-session prompt.
- Latency on big models is real; the deep-tier demo question should be pre-tested so you know it returns within demo patience (~10s). If slow, stream or show the routing card while it thinks — the card IS the product.
- Never call Cortex from client components; server routes only (keys stay server-side).
