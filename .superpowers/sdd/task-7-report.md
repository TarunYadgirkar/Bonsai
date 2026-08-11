# Task 7 report — independent-process restart survival

Date: 2026-08-11
Lane: `copy-b`
Base: `909a6e09d5c2b7383ddfe502ac4b506e92011306`

## Scope delivered

- Added a two-phase worker invoked as two independent Node processes with `--import tsx`.
- Invoked the exported conversation, chat, branch, merge, state, persistence, and economics route handlers with real `Request` objects rather than a Next.js server.
- Process A created a second root forest, chatted on its root, created and answered a branch, merged and archived it, created a nested branch, captured the fully published state/tree/logs, and read all public persistence views.
- Process B loaded the exact Process A checkpoint, chatted on the nested branch, captured the new fully published state/tree/logs, and reread all public persistence views.
- Used manual `claude-fable-5` / `max` selections for delivered answers so no classifier or retry variability affects the contract.
- Made no persistence backend, runtime, UI, fixture, or route production changes.

## RED → GREEN evidence

1. The initial focused test launched the required worker before that file existed. `npx vitest run lib/persistence/restart.test.ts` failed with `ERR_MODULE_NOT_FOUND` for `scripts/persistence-restart-worker.ts`.
2. Added the bounded worker and complete restart contract. The focused test passed through actual write and read processes against one temporary file store.
3. Independent review found that Process A's original expected checkpoint was itself route-reloaded. The worker now captures complete published state, tree, conversations, persistence status, and inference logs before public reads; the test requires Process A and fresh Process B reads to equal that accepted baseline.
4. Review also found Process B needed the same accepted-state proof after its nested chat. The strengthened test failed while the worker omitted that snapshot, then passed after Process B captured its complete published baseline and request content before rereading.

## Contract evidence

- Every persisted `createdAt` and inference `ts` value remains raw and exact across both process boundaries; no semantic checkpoint field is normalized.
- The generated root and all six fixture branches persist unchanged beside one independent root, its archived child, and its depth-two nested child.
- Parent and nested briefs remain exact; the nested brief references the answered parent's brief.
- The merged insight remains active on the independent root with exact evidence text and source-message IDs.
- Exact new inference purposes are `chat`, `compile`, `chat`, `merge`, `compile`, then the post-restart `chat`; every delivered chat uses the manual Fable/max override.
- New conversation, message, brief, log, and insight IDs consume one contiguous global suffix range after fixture sequence 44, including the post-restart continuation.
- File persistence is ready and durable at revision 5 after Process A and revision 6 after Process B.

## Isolation and security

- Each child receives a replacement environment allowlist rather than inherited `process.env`.
- The harness explicitly selects the file backend and clears root-only fixture, Vercel, database, Upstash/KV, provider-key, and provider-model variables.
- `BONSAI_DATA_DIR` is an absolute `mkdtemp` directory; cleanup removes only each exact recorded directory.
- Child execution is limited to 30 seconds and 1 MiB output. Worker failures emit stable messages without response bodies, secrets, environment values, or data paths.

## Verification evidence

- Focused restart suite: 1 file, 7 tests passed.
- Full `npm test`: 21 files, 254 tests passed.
- `npx tsc --noEmit -p tsconfig.json`: passed.
- `npm run lint`: passed with no findings.
- `npm run build -- --webpack`: passed; eight static pages generated and all API routes emitted as dynamic routes.
- `npx vitest run fixtures/seed-tree.test.ts`: 5 tests passed.
- `git diff --check`: passed.
- Focused secret scan found no high-confidence credential patterns.
- Focused debug scan found no `console.log`, `console.debug`, `debugger`, TODO, FIXME, or inherited-environment spread.

## Independent reviews

- Code review initially found incomplete full-state comparisons and contradictory selector documentation. Both were fixed; a second Process B completeness finding was reproduced and fixed. Final re-review reported no Critical or Important findings.
- TypeScript review independently found the missing exact accepted-message assertions. Final staged re-review passed focused Vitest, strict TypeScript, ESLint, and diff checks with no remaining Critical or Important findings.
- Security review verified the fixed command, replacement environment, absolute temporary directory, timeout, output bound, generic failures, JSON parsing, and exact cleanup with no Critical or Important findings.

## Concerns

- Cross-process file locking remains outside this single-writer restart milestone, as documented in the durability plan.

## Spec-review follow-up

- Timestamp RED: `npx vitest run lib/persistence/restart.test.ts -t "preserves raw persisted timestamps"` failed because every stored timestamp was `<timestamp>`; GREEN passed after removing checkpoint normalization.
- Preflight RED: `npx vitest run lib/persistence/restart.test.ts -t "rejects a mismatched preflight checkpoint"` resolved and performed the nested chat instead of rejecting; GREEN passed after validating a bounded private expected-checkpoint file before `chatPost`.
- Missing-store RED: `npx vitest run lib/persistence/restart.test.ts -t "rejects a missing store"` failed because public preflight reads recreated the deleted data directory; GREEN leaves the directory absent.
- Stale-file RED: `npx vitest run lib/persistence/restart.test.ts -t "rejects an unexpected stale file"` resolved after public preflight reads deleted the stale file; GREEN rejects and leaves the file untouched.
- Directory-bound RED: `npx vitest run lib/persistence/restart.test.ts -t "streams persistence entries"` failed while the fingerprint materialized an entire directory with `readdir`; GREEN streams through `opendir` and rejects the 513th entry before storing it.
- Unrelated-state RED: `npx vitest run lib/persistence/restart.test.ts -t "detects an unrelated entry"` failed because the comparison helper did not reject a changed fixture entry; GREEN passed after exact unaffected-ID comparison.
- The checkpoint file is created with `0600` and `wx` in the same private temporary parent as `BONSAI_DATA_DIR`. Process B accepts only an absolute sibling path, opens it with `O_NOFOLLOW`, requires a private regular single-link file no larger than 1 MiB, reads it to a stable size, and parses bounded JSON. Before any route load, it computes a bounded SHA-256 fingerprint over every sorted persistence directory entry and file byte through no-follow handles; only an exact fingerprint may proceed to the semantic checkpoint comparison and nested chat.
- Process B now proves every unaffected conversation and tree node is byte-semantic equal, all prior inference events remain an exact prefix, and the nested messages, node, final log, economics totals/baseline, sequence, and persistence revision are the only accepted changes.
- Fresh code re-review approved the raw preflight, missing/stale rejection, exact delta checks, and streamed global entry bound with no Critical or Important findings.
- Fresh TypeScript re-review approved the child-process typing, async handle closure, 4 MiB/512-entry bounds, checkpoint parsing, and cleanup with no Critical or Important findings.
- Fresh security re-review approved the replacement environment, private no-follow checkpoint, pre-load fingerprint, stable errors, exact cleanup, timeout, and output bound with no Critical or Important findings.
