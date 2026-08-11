# Task 6 report — fixture isolation

Date: 2026-08-11
Lane: `copy-b`
Base: `7b55d4c7366c70396e55f2dfe194b344cc94c0c5`

## Scope delivered

- Forced mock provider selection before API-key inspection when `BONSAI_ROOT_ONLY_FIXTURE=1` outside production.
- Preserved live provider selection in production even when the root-only flag is inherited.
- Pinned the supported fixture server command to `NODE_ENV=development` so a caller's production environment cannot disable root-only isolation.
- Strengthened persistence selector coverage for inherited Vercel, explicit KV, Neon, Upstash, KV REST, and file data-directory configuration.
- Proved root-only selection returns memory without creating either `.bonsai` or the configured data directory.
- Locked the generated fixture to six named branches and eighteen inference events with the exact purpose breakdown and order.
- Did not refactor the existing memory-first persistence selector or root-only store behavior.

## RED → GREEN evidence

1. Added provider, persistence-selector, supported-command, and fixture-contract tests before production edits.
2. `VITE_CONFIG_NATIVE_IGNORE_WARNING=true npx vitest run lib/provider.test.ts lib/persistence/select.test.ts fixtures/seed-tree.test.ts` failed with 2 behavioral failures and 15 passes:
   - non-production root-only mode selected `anthropic` instead of `mock` when provider variables were inherited;
   - `fixture:serve` did not start with `NODE_ENV=development`.
3. An initial fixture purpose-count expectation used `classify: 4` and `chat: 8`; inspection of the generator scenarios showed the nested follow-up correctly adds one classifier event, so the test setup was corrected to the existing semantic contract: `compile: 6`, `classify: 5`, `chat: 7`.
4. Added the provider selector early return and pinned the fixture serve environment.
5. The same focused command then passed 3 files and 17 tests.

## Fixture generation gate

- Confirmed Task 5's stable base before regeneration.
- Started the supported server with `npm run fixture:serve`; it reported development mode and listened only on `127.0.0.1:3111`.
- Ran `npm run fixture:build`; it generated six branches, eighteen logs, and sequence 44 through the real API routes.
- The contract records six compile, five classify, and seven chat events in exact generation order.
- `git diff --exit-code -- fixtures/seed-tree.json` passed after regeneration, proving deterministic byte-for-byte output with no semantic fixture change.
- `test ! -e .bonsai` passed before and after generation.

## Verification evidence

- Focused fixture-isolation gate: 3 files, 17 tests passed.
- Full `VITE_CONFIG_NATIVE_IGNORE_WARNING=true npm test`: 20 files, 247 tests passed.
- `npx tsc --noEmit -p tsconfig.json`: passed.
- `npm run lint`: passed with no findings.
- `npx next build --webpack`: passed; eight static pages generated and all API routes emitted as dynamic routes.
- `git diff --check`: passed.
- Changed-file secret scan: no high-confidence credential patterns.
- Changed-file debug scan: no `console.log`, `console.debug`, `debugger`, focused-only, or skipped-test markers.
- Fixture JSON diff gate and root-only `.bonsai` absence checks passed.

## Independent reviews

- Code review approved with no Critical or Important findings.
- TypeScript review approved with no Critical or Important findings; strict TypeScript, lint, full tests, and diff checks were independently rerun.
- Security review approved with no Critical or Important findings; focused tests and credential-pattern scanning were independently rerun.

## Concerns

- None. The generated fixture was already semantically correct and did not change.
