# Bonsai Branch B Build Log

This is the durable handoff for long-running copy-b work. Record decisions, commit IDs, verification evidence, blockers, and the exact next task. Do not use it as a diary.

## 2026-08-11 — Direction and architecture

Completed:

- audited all reachable history and branch topology;
- verified main production deployment and the desktop branch flow;
- identified the broken mobile layout;
- confirmed merge insights are currently omitted from later prompts;
- confirmed nested branches currently omit inherited briefs and ancestor insights;
- evaluated Claude subscriptions, Codex App Server, Chrome extensions, and MCP Apps;
- selected a local-first Bonsai runtime with official Codex App Server stdio integration;
- rejected third-party Claude consumer OAuth bridging;
- created an isolated copy-b worktree;
- wrote the runtime design and first implementation plan.

Evidence:

- Design: docs/superpowers/specs/2026-08-11-bonsai-local-runtime-design.md
- Plan: docs/superpowers/plans/2026-08-11-truthful-context-engine.md
- Production: https://bonsai-lac.vercel.app
- Production main commit at audit: 3ffc72472ea032ad3ce34e72ffe4e36f30cebc84

Key risks:

- the hosted API is unauthenticated and uses one global snapshot;
- App Server is an experimental coding-agent boundary and needs stronger OS isolation before public packaging;
- current persistence can fail silently;
- there are no automated tests yet.

Next:

- execute Task 1 of the truthful context engine plan using TDD;
- commit and push each independently verified task to copy-b.

## 2026-08-11 — Truthful context engine milestone

Completed:

- Task 1 (`77e408b`): added the context engine test harness;
- Task 2 (`59ef70a`): assembled visible context from the active branch path;
- Task 3 (`64d7c25`, review fix `d146bf7`): preserved and validated brief provenance;
- Task 4 (`aab9892`, review fixes `b643b49` and `75b103c`): applied tree context semantics through branch, chat, and merge flows;
- Task 5: regenerated the demo fixture, made the engine smoke output show each fact with its aligned source IDs, and updated the fixture immutability test to use the new generated contract while retaining explicit legacy-snapshot coverage.

Fixture regeneration evidence:

- started `DATABASE_URL= npx next dev --hostname 127.0.0.1 -p 3111` in mock mode and stopped it cleanly after generation;
- used an ephemeral empty fixture to meet the generator's root-only precondition because the checked-in fixture otherwise boots six branches; the empty bootstrap was never committed;
- ran `DATABASE_URL= BONSAI_BASE=http://127.0.0.1:3111 npx tsx scripts/build-seed-tree.ts` successfully;
- generator wrote 6 branches, 13 inference logs, and sequence 39;
- validated 6 briefs containing 36 facts and 380 source references: every brief has `sourceRefs` and `factSourceIds`, fact/source arrays align, and every cited source ID exists in that brief's `sourceRefs`;
- compared the regenerated tree with the prior fixture: branch identities, parent links, titles, message IDs, insight IDs, log IDs, scenario metadata, and sequence remained unchanged;
- ran `DATABASE_URL= ANTHROPIC_API_KEY= OPENAI_API_KEY= XAI_API_KEY= npx --no-install tsx scripts/try-engine.ts`: both routing cases passed and every printed fact included its provenance IDs.

Verification evidence:

- `npm test`: 7 files passed, 21 tests passed;
- `npm run lint`: passed with zero errors;
- `npm run build`: reached the default Turbopack production build, then failed because the sandbox forbids its CSS worker from binding a port (`Operation not permitted (os error 1)`);
- `npx next build --webpack`: production build passed, including TypeScript, 8/8 static-page generation steps, and route collection;
- `npx vitest run app/api/context-flow.test.ts`: 1 file passed, 2 tests passed independently.

Remaining risks:

- default Turbopack production builds still require an environment that permits its internal worker port; webpack is the accepted production gate in this sandbox;
- the fixture generator still needs a root-only bootstrap path; from the checked-in six-branch fixture, regeneration requires an ephemeral empty fixture before server startup;
- persistence still fails soft by design and must be proven through restart survival rather than inferred from a successful write;
- the hosted API remains unauthenticated and backed by one global snapshot;
- Codex App Server remains an experimental boundary that needs stronger OS isolation before public packaging.

Next:

- implement and verify local persistence, including restart-survival coverage.
