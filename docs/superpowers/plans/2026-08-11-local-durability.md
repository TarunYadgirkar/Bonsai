# Bonsai Local Durability Implementation Plan

Date: 2026-08-11
Lane: copy-b
Status: ready to execute
Design: `docs/superpowers/specs/2026-08-11-bonsai-local-runtime-design.md`

## Outcome

Bonsai must survive a real process restart without relying on a hosted database or silently losing accepted mutations.

The local file store is authoritative by default. It commits conversation revisions and inference events atomically enough that an interrupted write loads either the previous revision or the new revision, never a mixed tree. The hosted demo keeps an explicit KV backend. Tests keep an explicit memory backend.

This milestone is complete only when a new chat, branch, merge, nested branch, routing decision, and inference event survive two independent Node processes using the same temporary data directory.

## Invariants

- Conversation IDs never influence a path until they pass the existing strict ID validator.
- A manifest rename is the commit point.
- Conversation revision files are immutable after rename.
- Inference events are physically append-only. A reset advances an active byte range instead of rewriting history.
- A configured backend failure returns a typed error and a non-2xx response. It never falls back to memory.
- In-memory state becomes visible only after the durable commit succeeds.
- A corrupt current conversation revision may recover from a prior valid revision and report degraded health; it is never overwritten with fixture data.
- The non-production root-only fixture always uses memory and mock inference, regardless of inherited storage/provider variables.
- The first release is single-process and single-user. Multiple Bonsai servers must not share one local data directory.

## Contracts

```ts
export type PersistenceBackendKind = 'file' | 'kv' | 'memory';
export type PersistenceHealth = 'ready' | 'degraded' | 'error';

export interface PersistenceStatus {
  backend: PersistenceBackendKind;
  health: PersistenceHealth;
  durable: boolean;
  revision: number | null;
  message?: string;
  recoveredConversationIds?: string[];
}

export interface PersistenceBackend {
  readonly kind: PersistenceBackendKind;
  load(): Promise<
    | { status: 'miss'; persistence: PersistenceStatus }
    | {
        status: 'ready' | 'degraded';
        snapshot: StoreSnapshot;
        persistence: PersistenceStatus;
      }
  >;
  commit(
    previous: StoreSnapshot | null,
    next: StoreSnapshot,
    options?: { replaceInferenceLogView?: boolean },
  ): Promise<PersistenceStatus>;
  status(): PersistenceStatus;
}
```

Manifest V1:

```ts
interface ManifestV1 {
  schemaVersion: 1;
  revision: number;
  rootId: string;
  seq: number;
  conversations: Record<string, number>;
  inferenceLogStartBytes: number;
  inferenceLogBytes: number;
}
```

Disk layout:

```text
.bonsai/
  manifest.json
  conversations/
    <conversation-id>.r<revision>.json
  inference-log.jsonl
  quarantine/
```

Conversation files contain a schema-versioned envelope with the conversation ID and revision. Unsupported future schema versions fail without rewriting any file.

## Backend selection

Selection must be deterministic and tested:

1. `NODE_ENV=test` uses memory.
2. Non-production `BONSAI_ROOT_ONLY_FIXTURE=1` uses memory.
3. Explicit `BONSAI_PERSISTENCE_BACKEND=memory` is allowed only outside production.
4. Vercel or explicit `BONSAI_PERSISTENCE_BACKEND=kv` uses KV; missing KV configuration is an error.
5. Every other local launch uses `.bonsai`, even if `DATABASE_URL` happens to exist.

No selected file or KV backend may degrade to memory.

The file backend resolves its default directory as `<process.cwd()/.bonsai>`. Tests and local tooling may set `BONSAI_DATA_DIR` to an absolute path. Relative paths, empty paths, browser-provided paths, and production overrides are rejected. This variable is a process-start configuration boundary, never an API input.

## Task 1: Extract and version persisted schemas

Create:

- `lib/store-schema.ts`
- `lib/store-schema.test.ts`
- `lib/persistence/types.ts`
- `lib/persistence/schema.ts`
- `lib/persistence/schema.test.ts`
- `lib/persistence/errors.ts`

Modify:

- `lib/store.ts`
- `lib/store.test.ts`
- `lib/types.ts`

Tests first:

- Accept current conversations, multiple independent roots, and legacy-normalized briefs/logs.
- Reject unsafe or duplicate IDs, malformed nested routing/provenance/lifecycle fields, orphan parents, cycles, a non-root primary root, and `seq` lower than generated IDs.
- Parse Manifest V1 and matching conversation envelopes.
- Reject an envelope whose filename, ID, or revision disagree.
- Reject unknown future schema versions without mutation.

Move existing runtime validation and normalization out of `lib/store.ts`; do not weaken the checks landed in `d4a5063` and `9ba324f`. V1 is the first local schema, so do not invent a fake V0 migration. The next schema bump must add an explicit migration function.

Verification:

```bash
npx vitest run lib/store-schema.test.ts lib/persistence/schema.test.ts lib/store.test.ts
npx tsc --noEmit -p tsconfig.json
git diff --check
```

Commit:

```text
feat: validate persisted state
```

## Task 2: Add the atomic file backend

Create:

- `lib/persistence/atomic-file.ts`
- `lib/persistence/file.ts`
- `lib/persistence/file.test.ts`

Modify:

- `.gitignore`

Use real temporary directories in tests. Cover:

- First load returns a miss.
- First commit creates a manifest, immutable conversation revisions, and JSONL.
- Only changed conversations receive a new revision.
- Removed/reset nodes leave old revisions recoverable but disappear from the manifest.
- Normal log commits append only new entries.
- A commit with `replaceInferenceLogView: true` advances the active JSONL byte range without rewriting old events; ordinary commits may not infer this behavior from divergent arrays.
- Malicious IDs cannot escape `conversations/`.
- A fresh backend instance loads an equivalent snapshot.
- The default data directory is `<process.cwd()/.bonsai>`.
- A non-production absolute `BONSAI_DATA_DIR` is honored; relative and production overrides are rejected before any write.

Commit order:

1. Verify the expected manifest revision.
2. Remove any ignored JSONL suffix beyond the last committed byte.
3. Write changed node temp files with mode `0600`.
4. Sync, rename to immutable revision files, and sync the conversation directory.
5. Append and sync inference events.
6. Write and sync a manifest temp file.
7. Rename the manifest last and sync `.bonsai`.

The manifest rename is the logical commit point, but the directory sync is the durability acknowledgement. If that final sync fails, attempt an atomic rollback to the prior manifest. A confirmed rollback throws a typed commit failure and leaves memory on the prior snapshot; orphan node revisions and the uncommitted JSONL suffix remain ignored. If rollback cannot itself be durably confirmed, mark the backend `error`, prohibit further mutations, reload the visible manifest as authoritative state, and return a typed uncertain-commit error. Never report such a revision as fully durable.

Verification:

```bash
npx vitest run lib/persistence/file.test.ts
npx tsc --noEmit -p tsconfig.json
git diff --check
```

Commit:

```text
feat: add local file persistence
```

## Task 3: Recover interrupted and corrupt writes

Create:

- `lib/persistence/file-faults.test.ts`

Inject failures through the filesystem seam and reload through a fresh backend instance. Cover:

- Failure before a node rename loads the old revision.
- A renamed orphan node not referenced by the manifest is ignored.
- A JSONL suffix appended before a failed manifest commit is ignored.
- Failure before manifest rename loads the old revision.
- Success after manifest rename loads the new revision.
- Directory-sync failure after manifest rename performs and confirms a prior-manifest rollback, so memory and disk remain on the old revision.
- Failure to durably confirm that rollback poisons the backend, reloads the visible manifest, and blocks later mutations instead of guessing which revision won.
- Corruption inside the committed JSONL prefix returns an explicit error.
- A corrupt current node is moved to `quarantine/`, the highest valid prior revision is selected, the manifest is repaired, and health is degraded.
- A corrupt first revision with no valid predecessor returns an error and never seeds over it.
- Stale temp files are ignored and cleaned safely.

Verification:

```bash
npx vitest run lib/persistence/file-faults.test.ts lib/persistence/file.test.ts
git diff --check
```

Commit:

```text
fix: recover interrupted persistence writes
```

## Task 4: Serialize store transactions and adapt KV

Create:

- `lib/persistence/memory.ts`
- `lib/persistence/kv.ts`
- `lib/persistence/select.ts`
- `lib/persistence/select.test.ts`

Modify:

- `lib/store.ts`
- `lib/store.test.ts`
- `lib/kv.ts`
- mutation route tests

Implement one rejection-safe process-local transaction queue. `transactStore()` must load authoritative state, clone a draft, execute existing store operations against the draft, commit conversations and inference events once, and publish the draft only after success. A callback or confirmed commit failure restores the prior memory snapshot.

`PersistenceUncertainCommitError` is the explicit exception: `transactStore()` reloads the visible manifest through the backend, replaces memory with that authoritative snapshot, keeps the backend poisoned against later mutations, and returns 503. It must never restore a possibly stale prior snapshot or pretend the uncertain revision was acknowledged as durable.

Tests first:

- The full backend-selection matrix.
- A local launch remains file-backed when `DATABASE_URL` is present.
- Configured KV read/write failures throw typed persistence errors.
- Upstash non-2xx responses are failures, not false success.
- Two concurrent mutations preserve both results and unique sequence IDs.
- A state read started while a draft is paused inside commit waits for the transaction or observes the prior published snapshot, never the draft.
- A failed commit leaves conversations, logs, and sequence unchanged.
- An uncertain commit reloads exactly the backend-visible snapshot, reports error health, and blocks subsequent mutations instead of restoring a possibly stale draft or prior snapshot.
- Successful conversation mutations and their inference events commit together.
- A failed provider attempt can commit its completed inference events without committing staged messages or branches.

Remove the pending-log split only after route tests characterize it. Delete `lib/inference-log.ts` when JSONL ownership has fully moved into the backend.

Verification:

```bash
npx vitest run lib/persistence/select.test.ts lib/store.test.ts app/api/inference-logging.test.ts
npx tsc --noEmit -p tsconfig.json
git diff --check
```

Commit:

```text
feat: integrate durable store transactions
```

## Task 5: Expose persistence health and failure semantics

Create:

- `app/api/persistence/route.ts`
- `app/api/persistence/route.test.ts`

Modify:

- `app/api/state/route.ts`
- `app/api/economics/route.ts`
- `app/api/chat/route.ts`
- `app/api/branch/route.ts`
- `app/api/merge/route.ts`
- `app/api/conversation/route.ts`
- `app/api/reset/route.ts`
- `lib/types.ts`

Add `StateResponse.persistence`. Add safe persistence error codes to the existing API error shape. `GET /api/persistence` must work even when tree loading fails so the UI can show recovery guidance.

Tests first:

- No mutation route returns 2xx when its durable commit fails.
- A failed commit leaves state unchanged.
- An uncertain commit returns a distinct safe 503, exposes the reloaded authoritative state through reads, and leaves later mutations blocked until restart/recovery.
- State and economics return 503 for an unavailable configured backend.
- Recovered state reports degraded health and recovered conversation IDs.
- Memory reports `durable: false`; file and KV report `durable: true`.
- Provider 502 and persistence 503 remain distinguishable.
- Exact compiler, classifier, retry, merge, and answer event accounting remains unchanged.

Verification:

```bash
npx vitest run app/api/persistence/route.test.ts app/api/context-flow.test.ts app/api/inference-logging.test.ts app/api/validation.test.ts
npx tsc --noEmit -p tsconfig.json
git diff --check
```

Commit:

```text
feat: expose persistence status
```

## Task 6: Enforce and prove fixture isolation

The supported shell script clears provider variables, but the selector at current HEAD does not force mock inference when callers set the root-only flag directly. Update the provider selector itself so non-production root-only mode chooses mock before inspecting API-provider variables. Keep production behavior unchanged.

Modify as needed:

- `lib/provider.ts`
- `lib/provider.test.ts`
- `lib/persistence/select.test.ts`
- fixture scripts and tests

- Root-only development never creates `.bonsai`.
- Root-only never invokes KV even when storage variables exist.
- Root-only forces mock provider selection in non-production even when API-provider variables are inherited.
- Production ignores `BONSAI_ROOT_ONLY_FIXTURE`.
- The supported generator still creates six branches, eighteen exact inference events, and a fixture that passes its contract.

Do not manufacture a commit if existing coverage already proves the contract. Otherwise use:

```text
chore: keep fixtures memory-only
```

## Task 7: Prove real restart survival

Create:

- `lib/persistence/restart.test.ts`
- `scripts/persistence-restart-worker.ts`

Process A uses a temporary `BONSAI_DATA_DIR`, creates an independent root, chats, branches, merges, creates a nested branch, records routing and inference events, then exits. Process B launches independently against the same directory and prints normalized state and persistence status.

Assert exact tree state, immutable briefs, merged evidence, sequence continuity, inference events, and ready file-backend status. Assert that no seed fixture overwrote persisted data.

Final verification:

```bash
npx vitest run lib/persistence/restart.test.ts
npm test
npx tsc --noEmit -p tsconfig.json
npm run lint
npm run build -- --webpack
npx vitest run fixtures/seed-tree.test.ts
git diff --check
```

Run a focused secret/debug scan and two independent reviews. Update `README.md`, `AGENTS.md`, and `docs/BUILD_LOG.md` with exact behavior and evidence.

Commit:

```text
test: verify restart survival
```

## Risks deliberately left outside this milestone

- The transaction queue is process-local. Cross-process file locking belongs to desktop packaging.
- Current KV storage has no cross-lambda compare-and-swap and is not suitable for a hosted multi-user release.
- Directory syncing and rename behavior must be verified on macOS and Linux; Windows is a later packaging gate.
- Manifest-last recovery protects interrupted writes, not arbitrary disk loss.
- Authentication, per-user partitions, CSRF, rate limiting, export/delete, and stronger OS isolation remain public-release blockers.
