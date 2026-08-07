# docs/ — sponsor API references + tonight's checklist

Coding agents hallucinate APIs for products too new to be in their training data — EverMind especially. This folder is the antidote: real reference material, in the repo, so agents read instead of guess.

`evermind-notes.md` and `snowflake-notes.md` are working cheat sheets. **Tonight, add the official pages next to them** (browser → save page as markdown/text, or copy the relevant sections into new files here):

## Tonight (~20 minutes, both of you)

- [ ] **EverMind key:** sign up at everos.evermind.ai → get API key → into `.env.local` (both machines).
- [ ] **Save EverMind docs:** from docs.evermind.ai — the API-reference introduction/auth page and the v1 memory endpoints (add memories, search/retrieve). Save as `docs/evermind-official-*.md`.
- [ ] **Snowflake trial:** signup.snowflake.com → create trial account → note account URL → create a programmatic access token (or key-pair) → into `.env.local`.
- [ ] **Save Snowflake docs:** from docs.snowflake.com — the `AI_COMPLETE` function page and the "Cortex REST API" page (`/api/v2/cortex/inference:complete`). Save as `docs/snowflake-official-*.md`.
- [ ] **One test call each** (curl is fine — or run the pre-event scratch prompt from PROMPTS.md tomorrow at 10:15): Cortex completion returns text; EverOS add-memory returns 200. Tomorrow must not start with auth debugging.
- [ ] Push this repo to GitHub; both machines clone; both run `.env.local` from `.env.example`.
- [ ] Skim DEMO.md out loud once, together. Agree it's the movie you're making.

## At the sponsor hour tomorrow (10–11 AM)

Ask the EverMind and Snowflake engineers what they want to see used, and write it down here. If they hand out event credits/accounts, swap those in — trial accounts are the backup, not the plan.
