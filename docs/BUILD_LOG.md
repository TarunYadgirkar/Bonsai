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
- Task 3 (`64d7c25`, review fix `d146bf7`): preserved fact-to-source membership traceability;
- Task 4 (`aab9892`, review fixes `b643b49` and `75b103c`): applied tree context semantics through branch, chat, and merge flows;
- Task 5: regenerated the demo fixture, made the engine smoke output show each fact with its aligned source IDs, and updated the fixture immutability test to use the new generated contract while retaining explicit legacy-snapshot coverage.

Fixture regeneration evidence:

- started `DATABASE_URL= npx next dev --hostname 127.0.0.1 -p 3111` in mock mode and stopped it cleanly after generation;
- used an ephemeral empty fixture to meet the generator's root-only precondition because the checked-in fixture otherwise boots six branches; the empty bootstrap was never committed;
- ran `DATABASE_URL= BONSAI_BASE=http://127.0.0.1:3111 npx tsx scripts/build-seed-tree.ts` successfully;
- generator wrote 6 branches, 13 inference logs, and sequence 39;
- checked 6 briefs containing 36 facts and 380 source references: every brief has `sourceRefs` and `factSourceIds`, fact/source arrays align, and every named source ID exists in that brief's `sourceRefs`; this structural check did not establish semantic entailment;
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

## 2026-08-11 — Truthful core review fixes

Completed:

- removed canned Berkeley answers from the mock and made compiler/answer output depend on supplied evidence, including short sources and nested-brief fact extraction;
- validated every JSON POST contract before store access, ID allocation, inference, or mutation, with safe 400/413 responses for malformed, non-object, wrongly typed, unsupported, blank, or oversized input;
- staged chat turns and branch state until requested inference succeeded, while retaining exact logs for compiler, classifier, and failed retry calls that actually completed;
- preserved exact completion metadata per call, including requested model, effort, provider-reported tokens, upstream `servedBy`, modeled cost, and accepted/failed status;
- changed the counterfactual to one modeled ceiling-model, full-history baseline for the delivered answer only; compiler, classifier, merge, and failed-retry overhead receive exactly zero baseline;
- made blank merge completions fail safely without changing the parent or archive state, and log the exact completed usage as failed;
- runtime-validated KV snapshots, nested provenance/lifecycle fields, fact/source membership, tree acyclicity, and sequence monotonicity before replacing memory;
- persisted `model-cited`, `extractive`, or conservative `legacy-unknown` provenance without claiming semantic entailment;
- made configured provider failure explicit; mock inference is selected only when no provider is configured;
- added a supported non-production root-only fixture startup that forces memory-only storage even when KV environment variables exist;
- added the direct `tsx` development dependency required by the documented fixture command;
- committed and pushed the core implementation as `d4a5063` (`fix: harden truthful inference`).

Accounting convention:

- actual token counts are exact when a provider reports usage and estimated only when usage is absent;
- `estCostUsd` and economics totals are Bonsai catalog-equivalent estimates, not upstream invoices; the ceiling-model rate is explicitly a placeholder;
- only the final answer event delivered to the user receives one full-history counterfactual, including the current question exactly once;
- all internal calls and failed retries count in Bonsai totals but receive `baselineInputTokens = 0` and `baselineCostUsd = 0`.

Fixture regeneration evidence:

- ran `npm run fixture:serve`, whose environment selects non-production root-only, memory-only, no-key mock operation;
- ran `npm run fixture:build` in a second terminal; no fixture hand-edit or temporary empty fixture was used;
- generator wrote 6 branches, 18 inference logs, and sequence 44, then the server stopped cleanly;
- fixture contains 33 facts and 380 source references; every new fact is marked `extractive`, every named source ID belongs to its brief, persisted IDs are unique, and no query-like source text is stored as a fact;
- purpose counts are 6 compiler, 5 classifier, and 7 answer calls; the 7 delivered-answer events are the only nonzero baselines, and every internal baseline is exactly zero;
- the Blueprint manual branch persists `overridden: true` in both routing and its answer log.

Verification evidence:

- focused RED checks observed the intended grounding, blank-usage, legacy-provenance, KV-cycle/sequence/membership, and baseline failures before implementation;
- `npm test`: 12 files passed, 71 tests passed;
- `npx tsc --noEmit`: passed in strict mode;
- `npm run lint`: passed with zero errors;
- `npx next build --webpack`: production build passed, including TypeScript and all 8 static-page generation steps;
- `DATABASE_URL= ANTHROPIC_API_KEY= OPENAI_API_KEY= XAI_API_KEY= npx tsx scripts/try-engine.ts`: mock provider selected and both routing/grounding cases passed with extractive source IDs;
- `fixtures/seed-tree.test.ts`: 3 fixture citation, ID, provenance, accounting, override, and initial-question-baseline checks passed;
- `git diff --check`: passed;
- tracked-file secret-pattern scan returned no matches;
- `npm install --save-dev tsx` reported 0 audited vulnerabilities.

Environment exception:

- default `npm run build` still reaches Turbopack and fails only because this sandbox forbids its CSS worker from binding a local port (`Operation not permitted (os error 1)`); the webpack production build is green and this is not a code failure.

Remaining concerns:

- source-ID membership proves traceability only. A `model-cited` fact is not semantically validated or guaranteed to be entailed by its source; exact evidence excerpts remain a future enhancement;
- the deterministic no-key compiler is a relevance heuristic and can honestly decline a nested question when the immutable parent brief omitted the needed detail;
- local file persistence was deliberately not implemented in this segment;
- the hosted API remains unauthenticated and backed by one global snapshot.

Next:

- address local persistence as a separate, explicitly authorized task with restart-survival coverage.
