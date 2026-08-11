# Task 5 report — persistence status and failure semantics

Date: 2026-08-11
Lane: `copy-b`
Base: `fe7fcc64a7752c302280cf1f85e5c028057bdef5`

## Scope delivered

- Added `GET /api/persistence` and persistence route contract coverage.
- Added `StateResponse.persistence` and the stable API error codes `PROVIDER_UNAVAILABLE`, `PERSISTENCE_UNAVAILABLE`, `PERSISTENCE_COMMIT_FAILED`, and `PERSISTENCE_COMMIT_UNCERTAIN`.
- Converted chat, branch, merge, new-conversation, and reset mutations to one `transactStore()` callback per request.
- Kept request parsing and validation before transaction acquisition.
- Kept authoritative load, ID allocation, inference, mutation, completed-event logging, and durable commit inside the transaction boundary.
- Added safe 503 handling to state and economics reads; neither reads published process state after a configured backend load failure.
- Preserved backend-visible authoritative reads after uncertain reconciliation while keeping later mutations poisoned.
- Did not change persistence backend internals, runtime/UI code, fixture isolation, or restart-survival code.

## Decisions

- Added the narrow route helper `app/api/persistence-response.ts` so all routes use the same safe error classification without exposing exception messages.
- Classified `PersistenceUncertainCommitError` before its `PersistenceCommitError` superclass so ambiguous outcomes have a distinct stable code.
- Exposed `persistenceStatus()` from the store as a defensive backend status snapshot; the health route catches typed tree-load failures and still returns that safe status.
- Returned provider failures from inside a successful transaction only when completed inference events needed committing. Provider failures before accepted work abort the callback and preserve the 502 without an unnecessary commit.
- Kept failed chat/branch/merge inference events in the transaction draft while withholding staged messages, branch creation, insights, and archive changes.
- Kept `ApiError.code` optional so existing validation and domain-error response bodies remain backward compatible.

## RED → GREEN evidence

1. `npx vitest run app/api/persistence/route.test.ts` failed with exit 1 because the required new `app/api/persistence/route.ts` did not exist.
2. A minimal 501 route made the suite importable. The first fixture attempt exposed two test-fixture schema errors (a child missing a valid brief source and then source provenance); the fixture was corrected before implementation.
3. The valid behavioral RED run failed all 13 contracts: legacy mutation routes threw confirmed or uncertain persistence exceptions, state/economics threw load failures, the new health route returned 501, provider responses lacked a stable code, and state omitted persistence health.
4. After route conversion and safe response implementation, `npx vitest run app/api/persistence/route.test.ts` passed 13/13.
5. Independent review found that selector/configuration failures retried backend construction and semantic 4xx results still committed unchanged drafts. Four additional RED cases reproduced both issues.
6. Security review found that an initial file seed-commit failure could leave backend status `ready`. An actual file-backend fault RED reproduced the false health report.
7. The final persistence contract suite passed 18/18, and the focused plan gate passed 49/49 across persistence, context flow, exact inference logging, and validation.

## Contract evidence

- All five mutating route files contain one `transactStore()` call and no `loadStore()`, `saveStore()`, or `flushLogs()` calls.
- Confirmed commit failure tests cover chat, branch, merge, conversation, and reset; all return safe 503 responses.
- A failed new-conversation commit reloads as the unchanged authoritative snapshot.
- An uncertain commit returns `PERSISTENCE_COMMIT_UNCERTAIN`, exposes the reloaded winner through state, reports error health, and blocks a later mutation without a second commit attempt.
- State and economics return `PERSISTENCE_UNAVAILABLE` after injected load failure.
- The health endpoint returns a safe error health payload despite the same injected load failure.
- Degraded state includes recovered conversation IDs.
- Real memory, file, and KV backend instances report `durable: false`, `true`, and `true`, respectively.
- Provider 502 and persistence 503 bodies use different stable codes.
- Existing context-flow and inference-logging tests preserve exact compiler, classifier, retry, merge, and delivered-answer baseline accounting.

## Verification evidence

- Focused plan gate: 4 files, 49 tests passed.
- Full `npm test`: 20 files, 241 tests passed.
- `npx tsc --noEmit -p tsconfig.json`: passed.
- `npm run lint`: passed with no findings.
- `npx next build --webpack`: passed; 8 static pages generated and all API routes, including `/api/persistence`, emitted as dynamic routes.
- `git diff --check`: passed.
- Changed-file secret/debug scan: no matches.
- API raw-error scan: no exception messages, stacks, paths, provider responses, environment values, or backend internals are returned.

## Failures and warnings

- The initial RED fixture used an invalid parent/brief relationship and provenance source; those were test setup errors, corrected before treating the suite as behavioral RED.
- Vitest emits the repository's existing Vite native-config compatibility notice unless `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` is set. It is unrelated to Task 5 behavior.
- No persistence backend expansion was required.

## Independent reviews

- Code review initially found two Important issues: selector/configuration failures retried backend construction, and semantic 4xx paths committed unchanged drafts. Both were reproduced with RED tests and fixed. Re-review approved with no remaining Critical or Important findings.
- TypeScript review independently found the selector/configuration retry issue. Re-review verified typed missing-KV 503 handling and semantic transaction aborts, with no remaining Critical or Important findings.
- Security review found one Important false-ready health path after an initial file seed-commit failure. The route now conservatively reports safe error health when a typed load/seed failure occurs before backend health changes; the backend implementation remained untouched. Re-review approved with no remaining Critical or Important findings and no path, environment, backend-response, or secret leakage.
