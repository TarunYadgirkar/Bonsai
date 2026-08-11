# Codex App Server Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $subagent-driven-development (recommended) or $executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit local developer-preview Codex App Server stdio runtime that uses a Bonsai-owned Codex home and Codex-managed ChatGPT browser login, never accepts API keys or external ChatGPT tokens on this path, never falls back across runtimes, and records truthful runtime, billing, model, effort, and token metadata.

**Architecture:** Keep `complete()` as the engine seam and put runtime selection in front of the existing API adapters. A long-lived, process-local Codex client owns one private stdio child and admits one active turn; every Bonsai completion starts a fresh ephemeral Codex thread, applies a fixed empty working directory, `never` approvals, read-only/no-network settings supported by the installed stable schema, and extracts only the matching terminal final answer and latest per-turn usage. Local HTTP mutation and login are disabled until a loopback/Origin/Fetch-Metadata/capability gate succeeds; the browser can request only the fixed managed-ChatGPT login operation and receives only a validated authorization URL.

**Tech Stack:** Next.js 16 App Router, TypeScript strict mode, Node `child_process` stdio, newline-delimited JSON, Vitest 4, the installed `codex-cli 0.145.0`, and generated Codex App Server TypeScript/JSON schemas without `--experimental`.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-08-11-bonsai-local-runtime-design.md`; this plan implements only its Codex runtime milestone and the security/accounting prerequisites that milestone needs.
- Runtime selection is explicit: `BONSAI_RUNTIME=mock|codex|api:anthropic|api:openai|api:xai`; unset means `mock`, and the mere presence of any provider key never selects a runtime.
- Billing is exactly `none | chatgpt-subscription | developer-api`. Subscription use has no per-turn billed-dollar value and must never render as `$0 billed`; existing `estCostUsd` remains labeled as a Bonsai catalog model, not an upstream invoice.
- The Codex path accepts only Codex-managed ChatGPT browser login. It has no API-key, device-code, Bedrock, external-token, token-refresh, logout, or browser-supplied method/config/credential path.
- The only client methods Bonsai may emit are `initialize`, `initialized`, `account/read`, `account/login/start`, `account/login/cancel`, `account/rateLimits/read`, `model/list`, `thread/start`, `turn/start`, and `turn/interrupt`.
- Every server-initiated request and every command, file-change, filesystem, tool, approval, MCP, external-token-refresh, web-search, image, audio, skill, mention, hook, collaboration, or subagent event is a protocol fault: interrupt if possible, fail the completion, terminate after the grace period, and restart without replay.
- Classify prohibited requests/items/events before checking thread or turn IDs. A prohibited event with stale, missing, or attacker-chosen correlation IDs still faults the generation; all decoded messages and bytes count toward global generation/turn bounds.
- App Server transport is private stdio JSONL only. Do not add WebSocket, Unix-socket, remote, or browser-to-App-Server transport.
- One process owns one child and at most one active turn. Bound request count, pending bytes, stdout lines, events per turn, answer bytes, stderr diagnostics, timers, and shutdown grace; honor stdin backpressure.
- Each Bonsai completion creates a fresh `ephemeral: true` thread. Never resume, fork, inject, read, list, archive, or persist Codex threads.
- Use a fixed private empty cwd, `approvalPolicy: "never"`, `sandbox: "read-only"`, and per-turn `{ type: "readOnly", networkAccess: false }`. Omit `model`; map Bonsai effort explicitly; reject non-empty `instructionSources` before starting a turn.
- The served model starts with `thread/start.result.model` and changes only on a matching `model/rerouted`. Final text comes from a completed matching `agentMessage` with `phase: "final_answer"`, falling back to the last matching `phase: null` message only when no final-phase item exists. Usage comes from the latest matching `thread/tokenUsage/updated.tokenUsage.last`; missing usage is an error, not an estimate.
- Use a dedicated private Bonsai `CODEX_HOME`. Never copy, import, inspect, parse, log, or expose the user's ordinary Codex `auth.json`; managed login writes credentials only inside the dedicated instance.
- The Codex launcher accepts process configuration only, resolves canonical absolute files, verifies owner and write modes, uses `shell: false`, and passes a minimal explicit environment. It must not inherit provider keys, database/KV variables, `NODE_OPTIONS`, proxy variables, npm variables, or an attacker-controlled `PATH`.
- `codex-cli 0.145.0` generated without `--experimental` is the implementation contract. Current official docs describe newer restricted read access, but 0.145.0's stable generated `SandboxPolicy` has only `{ type: "readOnly", networkAccess: boolean }`; it has no `access`, `readableRoots`, or all-tools-off proof.
- This remains a developer preview even with a dedicated home, empty cwd, read-only/no-network policy, empty instruction sources, and fail-closed event handling. Public packaging is blocked until a version-gated stable schema supports restricted readable roots/tool denial and a deny-by-default OS sandbox passes adversarial tests on every supported platform.
- Local runtime mutation/login is disabled unless the dedicated launcher is actually listening on a random OS-assigned port at `127.0.0.1`, the request uses that literal Host and Origin, passes Fetch Metadata and JSON checks, carries both the per-launch header capability and matching HttpOnly `SameSite=Strict` cookie, and stays within login/mutation concurrency and rate bounds. Capabilities defend browser CSRF/DNS rebinding; they are not authentication against another process running as the same local user.
- Codex construction also requires an unforgeable process-local authorization scope. The loopback launcher is the sole owner of the browser runtime host, and Task 8's exact live opt-in is the sole owner of an isolated CLI runtime. Reloadable route/provider modules may only borrow the launcher-owned host; scripts, direct imports, and ordinary `npm run dev` cannot construct or spawn it.
- The launcher-owned runtime host and restart circuit live outside Next's reloadable module graph in one versioned `globalThis` registry. Route HMR may re-import borrowers but cannot create or orphan a child; launcher shutdown closes the host exactly once. An incompatible or duplicate registry installation fails closed.
- Do not claim that these local-preview checks secure the existing hosted demo. Hosted multi-user release remains blocked on authentication, user storage partitions, ownership authorization, CSRF, rate limiting, and concurrency controls.
- Additive persisted inference metadata requires explicit legacy normalization. Preserve missing metadata on old rows; do not relabel historical mock/API rows based on current environment or keys.
- The fake server and schema-drift gate never use credentials or live inference. The single live acceptance turn is opt-in and is never part of `npm test`, `npm run build`, or ordinary CI.
- Extensions, browser UI controls, responsive work, MCP/Chrome/Claude surfaces, desktop packaging, and public distribution are outside this plan.
- Follow repository conventions: immutable updates, boundary validation, safe public errors, no secret/auth URL logging, npm commands, test first, short Conventional Commits without trailers, and no unrelated refactors.

---

## Contract Evidence and Version Boundary

Planning-time verification ran:

```bash
codex --version
codex app-server generate-ts --out "$temporary_directory/ts"
codex app-server generate-json-schema --out "$temporary_directory/json"
```

The observed version was `codex-cli 0.145.0`. Neither generation command used `--experimental`; no login, account read, credential read, or inference was performed.

The [current official App Server documentation](https://developers.openai.com/codex/app-server) says stdio is JSONL, requires `initialize` then `initialized`, documents managed ChatGPT browser login, rate limits, terminal item/turn events, model reroutes, and restricted readable roots. The implementation must distinguish those docs-current statements from the installed stable generated contract:

| Concern | Stable generated 0.145.0 contract used here | Docs-current only; do not implement yet |
|---|---|---|
| Read-only sandbox | `SandboxPolicy = { type: "readOnly", networkAccess: boolean }` | `ReadOnlyAccess` with `type: "restricted"`, `includePlatformDefaults`, and `readableRoots` |
| Tool denial | No stable all-tools-off field | Any later documented tool/capability controls until the version gate proves them |
| Final answer | `agentMessage.phase` is `"commentary" \| "final_answer" \| null` | No assumption that every provider emits a non-null phase |
| Usage | `thread/tokenUsage/updated` contains `{ threadId, turnId, tokenUsage: { last, total, modelContextWindow } }` | No reconstruction from totals or estimates |
| Served model | `thread/start` returns `model`; `model/rerouted` supplies matching `threadId`, `turnId`, `fromModel`, `toModel` | No requested model override in the first preview |
| Instructions | `thread/start` returns `instructionSources: string[]` | No claim that an empty cwd alone prevents other instruction/config layers |
| Login | Stable input union contains unsafe alternatives, but Bonsai emits only `{ type: "chatgpt", useHostedLoginSuccessPage: true, appBrand: "chatgpt" }` | Device code, API key, Bedrock, and `chatgptAuthTokens` are rejected product paths |

## Planned File Map

| File | Responsibility |
|---|---|
| `lib/runtime-policy.ts` | Parse explicit runtime selection and expose non-secret readiness/billing metadata. |
| `lib/codex-app-server/protocol.ts` | Audited 0.145.0 stable subset, exact outbound allowlist, and fail-closed decoders. |
| `lib/codex-app-server/schema-contract.json` | Checked-in normalized facts extracted from stable generated TS/JSON schema. |
| `scripts/check-codex-app-server-schema.ts` | Generate without `--experimental` into a temporary directory and compare the normalized contract. |
| `lib/codex-app-server/config.ts` | Resolve and validate the executable, dedicated home, empty cwd, version, and minimal child environment. |
| `lib/codex-app-server/process.ts` | Spawn/terminate the stdio child with `shell: false`; sanitize bounded stderr. |
| `lib/codex-app-server/client.ts` | Handshake, bounded JSONL framing, exact correlation, backpressure, generations, and restart. |
| `lib/codex-app-server/completion.ts` | One-turn state machine, fresh ephemeral threads, final text, served model, effort, and exact usage. |
| `lib/codex-app-server/account.ts` | Redacted account/rate-limit/model status and managed ChatGPT login ownership. |
| `lib/codex-app-server/authorization.ts` | Opaque AsyncLocalStorage authorization scope for validated local HTTP and live acceptance only. |
| `lib/codex-app-server/local-host.ts` | Versioned launcher-owned runtime host registry that survives route HMR and owns cleanup/circuit state. |
| `lib/local-http-security.ts` | Loopback/Origin/Fetch-Metadata/content-type/capability/rate/concurrency checks. |
| `app/api/runtime/session/route.ts` | Same-origin capability bootstrap; sets the strict HttpOnly cookie. |
| `app/api/runtime/route.ts` | Safe GET status and fixed login start/cancel POST actions. |
| `lib/codex-app-server/test/fake-server.mjs` | Deterministic fake stdio server with adversarial scenarios. |
| `scripts/codex-live-acceptance.ts` | Explicitly opted-in one-turn managed-account acceptance check. |

## Public-Release Blockers

- [ ] A supported Codex version's stable generated schema proves restricted readable roots and a deny-all tool configuration; the version gate rejects older/unknown shapes.
- [ ] A deny-by-default OS sandbox prevents reads outside Bonsai's empty runtime directory and blocks process, filesystem, and network capabilities before App Server starts.
- [ ] Version-gated real App Server adversarial prompts run inside the deny-by-default OS sandbox with filesystem, process, and network canaries, and prove no canary read/write/child/egress before or after Bonsai rejects an event. Fake-server tests remain protocol evidence only and cannot close this blocker.
- [ ] Signed packaging, upgrades, export/delete, crash recovery, and platform-specific ownership/mode checks are complete.
- [ ] Hosted authentication, authorization, user partitions, CSRF, rate limits, and multi-user concurrency are implemented separately.

### Task 1: Make Runtime Choice and Accounting Explicit

**Files:**
- Create: `lib/runtime-policy.ts`
- Create: `lib/runtime-policy.test.ts`
- Modify: `lib/provider.ts`
- Modify: `lib/provider.test.ts`
- Modify: `lib/llm.ts`
- Modify: `lib/llm.test.ts`
- Modify: `lib/mock.ts`
- Modify: `lib/types.ts`
- Modify: `lib/store-schema.ts`
- Modify: `lib/store-schema.test.ts`
- Modify: `app/api/modes/route.ts`
- Create: `app/api/economics/route.test.ts`
- Modify: `app/api/economics/route.ts`
- Modify: `components/EconomicsPanel.tsx`
- Create: `components/EconomicsPanel.test.tsx`
- Modify: `components/RoutingChip.tsx`
- Modify: `components/Workspace.tsx`
- Modify: `scripts/try-provider.ts`
- Modify: `scripts/try-engine.ts`

**Interfaces:**
- Consumes: existing `CompleteParams`, `ProviderResult`, `CompleteResult`, `RoutingDecision`, `InferenceLog`, and `normalizeInferenceLog()`.
- Produces:

```ts
export type RuntimeSelection =
  | 'mock'
  | 'codex'
  | 'api:anthropic'
  | 'api:openai'
  | 'api:xai';

export type BillingMode = 'none' | 'chatgpt-subscription' | 'developer-api';

export interface RuntimePolicy {
  selection: RuntimeSelection;
  billing: BillingMode;
  readiness: 'ready' | 'missing-configuration' | 'preview-disabled';
  missingConfiguration?:
    | 'ANTHROPIC_API_KEY'
    | 'OPENAI_API_KEY'
    | 'XAI_API_KEY'
    | 'BONSAI_CODEX_EXECUTABLE';
}

export function runtimePolicy(
  env?: Readonly<Record<string, string | undefined>>,
): RuntimePolicy;
```

- Add required `runtime: RuntimeSelection`, `billing: BillingMode`, and optional `servedEffort?: string` to new `CompleteResult`/`ProviderResult` values. Add those three fields as optional persisted fields on `RoutingDecision` and `InferenceLog` solely for legacy compatibility. Every new completion/log must populate `runtime` and `billing`; populate `servedEffort` only when the selected runtime reports the effort actually applied. Absence means unavailable, never “same as requested.”
- Extend the internal `providerComplete()` parameter object with required `effort: Effort`; `complete()` passes its already-resolved effort. API adapters may ignore this field, while Task 7 passes it to Codex. Update every direct call in `lib/llm.ts`, `lib/provider.test.ts`, and `scripts/try-provider.ts`, and use `rg -n "providerComplete\\(" --glob '*.ts'` to prove no caller relies on the old shape.
- Make completion/routing/log `estCostUsd` nullable. It is non-null only when Bonsai deliberately applies an exact internal catalog model as a hypothetical comparison; Codex omits a model and therefore records `null`. Economics totals sum only non-null hypotheses and expose `unpricedInferenceCount`; existing panels render `not priced` for null and label all remaining dollars `hypothetical catalog cost`, never billed spend. Change `EconomicsBaseline.costSavedPct` to `number | null`: it is `null` whenever `unpricedInferenceCount > 0`, because comparing an all-call baseline with a partial priced-call total is invalid. The route and panel render the savings comparison as unavailable with the unpriced count in that case. Add mixed priced/unpriced route and component assertions. These are compatibility/truth corrections to existing displays, not the excluded runtime-control UI.

**Dependencies:** None.

**Risk:** High — changing the default from key-driven live inference to explicit mock selection is intentional but user-visible; tests must lock the selection matrix and no-fallback behavior.

- [ ] **Step 1: Write failing runtime-selection and migration tests**

```ts
it.each([
  [{}, { selection: 'mock', billing: 'none', readiness: 'ready' }],
  [{ OPENAI_API_KEY: 'present-but-not-selected' }, { selection: 'mock', billing: 'none', readiness: 'ready' }],
  [{ BONSAI_RUNTIME: 'codex' }, { selection: 'codex', billing: 'chatgpt-subscription', readiness: 'preview-disabled' }],
  [{ BONSAI_RUNTIME: 'codex', BONSAI_LOCAL_PREVIEW: '1' }, { selection: 'codex', billing: 'chatgpt-subscription', readiness: 'missing-configuration', missingConfiguration: 'BONSAI_CODEX_EXECUTABLE' }],
  [{ BONSAI_RUNTIME: 'api:openai' }, { selection: 'api:openai', billing: 'developer-api', readiness: 'missing-configuration', missingConfiguration: 'OPENAI_API_KEY' }],
])('selects only the explicit runtime', (env, expected) => {
  expect(runtimePolicy(env)).toEqual(expected);
});

it('preserves absent metadata on a legacy inference row', () => {
  const normalized = normalizeInferenceLog(legacyInferenceLog());
  expect(normalized).not.toHaveProperty('runtime');
  expect(normalized).not.toHaveProperty('billing');
  expect(normalized).not.toHaveProperty('servedEffort');
});

it('does not calculate savings across an unpriced turn', async () => {
  const economics = await economicsFor([pricedLog(), codexUnpricedLog()]);
  expect(economics.totals.unpricedInferenceCount).toBe(1);
  expect(economics.baseline.costSavedPct).toBeNull();
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npx vitest run lib/runtime-policy.test.ts lib/provider.test.ts lib/llm.test.ts lib/store-schema.test.ts app/api/economics/route.test.ts components/EconomicsPanel.test.tsx`

Expected: FAIL because `runtimePolicy`, runtime/billing metadata, and strict new-row validation do not exist, and provider keys still select a provider implicitly.

- [ ] **Step 3: Implement explicit policy and truthful metadata**

Implement a total parser that rejects unknown/blank `BONSAI_RUNTIME` with a safe configuration error. `codex` is `preview-disabled` unless `BONSAI_LOCAL_PREVIEW=1`, then remains `missing-configuration` until `BONSAI_CODEX_EXECUTABLE` is an absolute path; Task 3 performs canonical file/ownership/mode validation. API selections are ready only when their matching key exists. Never inspect unrelated keys to pick a runtime. Make `providerComplete()` switch on the explicit selection: `mock` returns `null`, selected API calls exactly that provider, and the Task 1 `codex` branch raises the fixed safe `ProviderUnavailableError('Codex runtime unavailable')` that Task 7 replaces with the real adapter. No failure crosses to another branch.

For new completions/logs, propagate:

```ts
{
  runtime: policy.selection,
  billing: policy.billing,
  servedEffort: providerResult.servedEffort,
}
```

Keep `estCostUsd` explicitly named and documented as modeled catalog cost. `app/api/modes/route.ts` must return a billing note that distinguishes modeled catalog economics from billed dollars and says subscription turns have no per-turn invoice amount.

Replace `providerName()`/`providerSummary()` with non-secret runtime-policy diagnostics so scripts cannot contradict explicit selection. `scripts/try-provider.ts` requires an explicit `api:*` runtime, supplies a deterministic effort, and never describes API failure as mock fallback. `scripts/try-engine.ts` prints `runtimePolicy().selection` rather than inferring from keys and refuses `codex` before calling `complete()`; only Task 8 may drive a live Codex CLI turn.

In `parseInferenceLog(value, allowLegacy)`, require valid runtime/billing metadata when `allowLegacy` is false. When legacy mode is true, preserve absence exactly rather than deriving metadata from `servedBy`, model names, current keys, or the current runtime.

- [ ] **Step 4: Run GREEN verification**

Run: `npx vitest run lib/runtime-policy.test.ts lib/provider.test.ts lib/llm.test.ts lib/store-schema.test.ts lib/mock.test.ts app/api/inference-logging.test.ts app/api/economics/route.test.ts components/EconomicsPanel.test.tsx`

Expected: PASS; a key without `BONSAI_RUNTIME` remains mock, selected missing API configuration is an explicit failure, and old persisted rows remain unlabeled.

Run: `npx tsc --noEmit -p tsconfig.json && git diff --check`

Expected: both commands exit 0.

Run: `npm run build`

Expected: the repository-mandated production build exits 0 before commit.

- [ ] **Step 5: Commit**

```bash
git add lib/runtime-policy.ts lib/runtime-policy.test.ts lib/provider.ts lib/provider.test.ts lib/llm.ts lib/llm.test.ts lib/mock.ts lib/types.ts lib/store-schema.ts lib/store-schema.test.ts app/api/modes/route.ts app/api/economics/route.ts app/api/economics/route.test.ts components/EconomicsPanel.tsx components/EconomicsPanel.test.tsx components/RoutingChip.tsx components/Workspace.tsx scripts/try-provider.ts scripts/try-engine.ts
git commit -m "feat: select inference runtime explicitly"
git push origin copy-b
```

### Task 2: Pin the Stable 0.145.0 Protocol Contract

**Files:**
- Create: `lib/codex-app-server/protocol.ts`
- Create: `lib/codex-app-server/protocol.test.ts`
- Create: `lib/codex-app-server/schema-contract.json`
- Create: `scripts/check-codex-app-server-schema.ts`
- Create: `.github/workflows/codex-schema-drift.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: generated 0.145.0 JSON schemas produced by `codex app-server generate-json-schema --out <temporary-directory>` without `--experimental`.
- Produces:

```ts
export const CODEX_APP_SERVER_VERSION = '0.145.0' as const;

export const CODEX_CLIENT_METHODS = [
  'initialize',
  'initialized',
  'account/read',
  'account/login/start',
  'account/login/cancel',
  'account/rateLimits/read',
  'model/list',
  'thread/start',
  'turn/start',
  'turn/interrupt',
] as const;

export type CodexClientMethod = (typeof CODEX_CLIENT_METHODS)[number];
export function decodeServerLine(value: unknown): CodexServerMessage;
export function assertAllowedClientMethod(method: string): asserts method is CodexClientMethod;
```

`CodexServerMessage` is a discriminated union of correlated responses plus only the notification shapes needed by account/completion state. Every object is decoded from `unknown` with exact required field/type/length checks and bounded strings/arrays; generated types are evidence, not runtime validation.

All numeric protocol fields use explicit domains. Token counts, context windows, reset timestamps, request IDs, and pagination counts must be finite, nonnegative safe integers no greater than `Number.MAX_SAFE_INTEGER`; fields with a smaller schema maximum use that smaller maximum. Rate-limit percentages must be finite numbers in `[0, 100]`. Reject `NaN`, infinities, fractions where integers are required, negatives, unsafe integers, and percentages outside the closed range before state changes.

**Dependencies:** None; this task pins the external contract before production process code exists.

**Risk:** Medium — schema generators can change formatting without semantic drift, so compare normalized audited facts rather than raw files.

- [ ] **Step 1: Write failing allowlist and stable-shape tests**

```ts
it.each(CODEX_CLIENT_METHODS)('accepts allowed method %s', (method) => {
  expect(() => assertAllowedClientMethod(method)).not.toThrow();
});

it.each(['thread/resume', 'account/logout', 'config/read', 'fs/readFile', 'command/exec'])
  ('rejects forbidden method %s', (method) => {
    expect(() => assertAllowedClientMethod(method)).toThrow('unsupported Codex method');
  });

it('records the stable read-only limitation', () => {
  expect(schemaContract.sandboxPolicy.readOnlyRequired).toEqual(['type', 'networkAccess']);
  expect(schemaContract.sandboxPolicy).not.toHaveProperty('readableRoots');
  expect(schemaContract.publicReleaseReady).toBe(false);
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npx vitest run lib/codex-app-server/protocol.test.ts`

Expected: FAIL because the audited protocol module and contract snapshot do not exist.

- [ ] **Step 3: Implement the audited subset and drift extractor**

The checked-in normalized JSON records the CLI version; the exact client-method allowlist; all stable server-request method names that must be rejected; required fields for initialize, managed login, account, rates, model list, thread start, turn start/interrupt, terminal item/turn, token usage, and model reroute; and the absence of restricted readable roots/all-tools-off fields.

`scripts/check-codex-app-server-schema.ts` must:

1. Accept only an absolute executable path from `BONSAI_CODEX_EXECUTABLE` or the explicit CLI argument used by CI, canonicalize it with `realpath`, and spawn with `shell: false`; when the canonical file is JavaScript, invoke it through canonical `process.execPath` so no shebang or `PATH` lookup occurs. This schema-only command does not own the production launcher introduced in Task 3.
2. Run `--version` and require exactly `codex-cli 0.145.0`.
3. Create an OS temporary directory with a private empty `CODEX_HOME`, pass a from-scratch environment without keys/proxies/database/`NODE_OPTIONS`/`PATH`, invoke both `generate-ts` and `generate-json-schema` without `--experimental`, normalize only the audited facts, compare them with `schema-contract.json`, and remove the temporary directory.
4. Exit nonzero on added/removed required fields, method drift, final-phase drift, usage drift, login drift, or sandbox drift. A newly available restricted-root field is a deliberate review event, not an automatic public-release unlock.

Protocol tests include numeric boundaries for token usage, context windows, reset timestamps, pagination, and rate-limit percentages; malformed values fail decoding and force the client generation to restart in the Task 4 integration test.

Add `"codex:schema:check": "tsx scripts/check-codex-app-server-schema.ts"`. The workflow installs `@openai/codex@0.145.0`, runs this command, and performs no login or inference.

- [ ] **Step 4: Run GREEN verification**

Run: `npx vitest run lib/codex-app-server/protocol.test.ts`

Expected: PASS with all forbidden methods and malformed/oversized server messages rejected.

Run: `BONSAI_CODEX_EXECUTABLE="$(command -v codex)" npm run codex:schema:check`

Expected: PASS, reporting `codex-cli 0.145.0`, `--experimental: false`, and `public release sandbox: blocked` without reading account or credential state.

Run: `npm run build`

Expected: the repository-mandated production build exits 0 before commit.

- [ ] **Step 5: Commit**

```bash
git add lib/codex-app-server/protocol.ts lib/codex-app-server/protocol.test.ts lib/codex-app-server/schema-contract.json scripts/check-codex-app-server-schema.ts .github/workflows/codex-schema-drift.yml package.json
git commit -m "test: pin Codex protocol contract"
git push origin copy-b
```

### Task 3: Build the Private, Minimal Codex Process Boundary

**Files:**
- Create: `lib/codex-app-server/config.ts`
- Create: `lib/codex-app-server/config.test.ts`
- Create: `lib/codex-app-server/process.ts`
- Create: `lib/codex-app-server/process.test.ts`

**Interfaces:**
- Consumes: `CODEX_APP_SERVER_VERSION` from Task 2 and the existing local data-directory boundary.
- Produces:

```ts
export interface CodexLaunchConfig {
  command: string;
  argsPrefix: readonly string[];
  appServerArgs: readonly ['app-server', '--listen', 'stdio://', '--strict-config'];
  codexHome: string;
  emptyCwd: string;
  env: Readonly<Record<string, string>>;
}

export async function resolveCodexLaunchConfig(options: {
  executable: string;
  dataDirectory: string;
}): Promise<CodexLaunchConfig>;

export interface CodexChild {
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  terminate(signal: NodeJS.Signals): void;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export async function spawnCodexAppServer(config: CodexLaunchConfig): Promise<CodexChild>;
```

**Dependencies:** Task 2.

**Risk:** Critical — a path, ownership, mode, or environment mistake can execute attacker-controlled code or expose inherited credentials.

- [ ] **Step 1: Write failing path, owner, mode, environment, and spawn tests**

Use real temporary directories and fake executable files. Cover: relative/missing/non-file executables; symlink canonicalization; current-user/root ownership; rejection of group/world-writable files or ancestors; a JavaScript launcher invoked through canonical `process.execPath`; native executable invocation; private `0700` directories; refusal when the fixed cwd is non-empty; no file read under `codexHome` after creation; a 2-second `--version` probe timeout; process-group termination; and preview refusal on platforms where the implementation cannot contain the child process tree.

```ts
expect(config.env).toEqual({
  CODEX_HOME: expectedCodexHome,
  LANG: 'C.UTF-8',
  NO_COLOR: '1',
  TMPDIR: expectedPrivateTempDirectory,
});
expect(config.env).not.toHaveProperty('PATH');
expect(config.env).not.toHaveProperty('OPENAI_API_KEY');
expect(spawn).toHaveBeenCalledWith(config.command, expectedArgs, {
  cwd: config.emptyCwd,
  env: config.env,
  shell: false,
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: true,
  windowsHide: true,
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npx vitest run lib/codex-app-server/config.test.ts lib/codex-app-server/process.test.ts`

Expected: FAIL because no private launcher boundary exists.

- [ ] **Step 3: Implement canonical launch validation and dedicated state**

Require `BONSAI_CODEX_EXECUTABLE` to be an absolute process-start setting; never accept it in an HTTP body. Resolve it with `realpath`, verify a regular current-user/root-owned non-group/world-writable file and safe ancestors, and validate the same properties on `process.execPath` when invoking a `.js` launcher. This safely supports the npm Codex launcher without relying on a shebang or `PATH`.

Create `<dataDirectory>/codex-runtime/home`, `<dataDirectory>/codex-runtime/empty-cwd`, and `<dataDirectory>/codex-runtime/tmp` with `0700` modes and no-follow/same-owner checks. The home is persistent so managed login survives restart; the cwd must contain zero entries before every child start. Do not enumerate or read home contents, and specifically never look for another Codex home or `auth.json`.

The child environment is constructed from scratch. On POSIX it contains only `CODEX_HOME`, `LANG`, `NO_COLOR`, and the private `TMPDIR`. Never spread `process.env`. Probe `--version` through the same command/args prefix with a bounded stdout/stderr reader, a 2-second wall-clock timeout, and whole-process-group termination before starting App Server; return a disconnected status unless it is exactly 0.145.0. The first preview is POSIX-only: report Windows as unsupported until a Job Object or equivalent verified whole-tree containment exists.

Spawn App Server in a new POSIX process group and terminate the group, not only the direct PID, on timeout/protocol fault/exit. Treat process-group containment as best effort: a hostile descendant may escape, so only the future OS sandbox/canary gate can close the public blocker.

Drain stderr continuously into a 64 KiB ring; cap each decoded diagnostic at 4 KiB, strip control characters/URLs/path-like substrings, and expose only stable error categories to callers. Never log raw stderr, authorization URLs, JSONL messages, prompts, account data, or credentials.

- [ ] **Step 4: Run GREEN verification**

Run: `npx vitest run lib/codex-app-server/config.test.ts lib/codex-app-server/process.test.ts`

Expected: PASS, including tests that seed fake provider/database/proxy/`NODE_OPTIONS`/`PATH` variables and prove none reach the child.

Run: `npx tsc --noEmit -p tsconfig.json && git diff --check`

Expected: both commands exit 0.

Run: `npm run build`

Expected: the repository-mandated production build exits 0 before commit.

- [ ] **Step 5: Commit**

```bash
git add lib/codex-app-server/config.ts lib/codex-app-server/config.test.ts lib/codex-app-server/process.ts lib/codex-app-server/process.test.ts
git commit -m "feat: isolate Codex process state"
git push origin copy-b
```

### Task 4: Implement the Bounded JSONL Client

**Files:**
- Create: `lib/codex-app-server/client.ts`
- Create: `lib/codex-app-server/client.test.ts`
- Modify: `lib/codex-app-server/process.ts`

**Interfaces:**
- Consumes: `CodexChild`, `spawnCodexAppServer()`, `CodexClientMethod`, and `decodeServerLine()` from Tasks 2–3.
- Produces:

```ts
export interface CodexRequestMap {
  initialize: { params: InitializeParams; result: InitializeResult };
  'account/read': { params: { refreshToken: false }; result: AccountReadResult };
  'account/login/start': { params: ChatGptLoginParams; result: ChatGptLoginResult };
  'account/login/cancel': { params: { loginId: string }; result: { status: 'canceled' | 'notFound' } };
  'account/rateLimits/read': { params: undefined; result: RateLimitsResult };
  'model/list': { params: ModelListParams; result: ModelListResult };
  'thread/start': { params: ThreadStartParams; result: ThreadStartResult };
  'turn/start': { params: TurnStartParams; result: TurnStartResult };
  'turn/interrupt': { params: TurnInterruptParams; result: Record<string, never> };
}

export class CodexAppServerClient {
  constructor(options: {
    spawn: () => Promise<CodexChild>;
    requestTimeoutMs?: number;
    maxPendingRequests?: number;
    maxPendingWriteBytes?: number;
    maxMessagesPerGeneration?: number;
    maxDecodedBytesPerGeneration?: number;
    maxRequestIdsPerGeneration?: number;
  });
  request<M extends Exclude<CodexClientMethod, 'initialized'>>(
    method: M,
    params: CodexRequestMap[M]['params'],
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<CodexRequestMap[M]['result']>;
  initialize(): Promise<void>;
  subscribe(listener: (event: CodexServerEvent) => void): () => void;
  restart(reason: CodexRestartReason): Promise<void>;
  close(): Promise<void>;
}
```

**Dependencies:** Tasks 2–3.

**Risk:** Critical — correlation, bounds, or restart mistakes can misattribute output, deadlock the server, or replay a prompt.

- [ ] **Step 1: Write failing framing/correlation/backpressure/generation tests**

Cover split/coalesced lines; LF and one optional CR; invalid UTF-8/JSON/top-level shapes; a line above 1 MiB; more than 32 pending requests; more than 1 MiB pending outbound bytes; more than 4,096 decoded messages or 16 MiB total decoded bytes per generation; more than 4,096 request IDs in one generation; unknown/duplicate IDs; response error propagation; notifications interleaved with responses; stdin `write() === false` waiting for `drain`; stdout pause/resume around a 256-event high/128-event low watermark; child exit; and a stale response from generation N never satisfying generation N+1.

Also inject every method in the stable `ServerRequest` union, including `account/chatgptAuthTokens/refresh`, and assert the client emits a bounded `-32601` response, fails active work, and restarts. No server request may invoke a callback supplied by browser or application code.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npx vitest run lib/codex-app-server/client.test.ts`

Expected: FAIL because the client and generation/correlation state do not exist.

- [ ] **Step 3: Implement bounded connection and restart semantics**

Use an incrementing generation and numeric request ID. Key pending requests by both; require exact ID equality and exactly one of `result`/`error`. Serialize writes through a bounded queue, append one newline, and await `drain` before dequeuing another write.

The constructor owns the repeatable spawn closure used for the initial child and every restart. Task 7 supplies `spawn: () => spawnCodexAppServer(launchConfig)` after validating one immutable launch configuration; no restart re-reads process environment or accepts request-scoped configuration. Apply the fixed defaults from this task and reject invalid or above-policy overrides.

Handshake for every generation:

```ts
await request('initialize', {
  clientInfo: { name: 'bonsai', title: 'Bonsai', version: '0.1.0' },
  capabilities: {
    experimentalApi: false,
    requestAttestation: false,
    mcpServerOpenaiFormElicitation: false,
  },
});
await writeNotification({ method: 'initialized' });
```

Reject public `request()` calls before handshake and calls to methods outside the exact allowlist. On protocol fault/exit, reject all pending promises for that generation, stop accepting writes, terminate the whole process group with `SIGTERM`, wait 2 seconds, and use group `SIGKILL` if needed. Permit at most three child starts in a rolling 60-second window with 100 ms then 500 ms backoff; opening the circuit disables automatic recovery until the Bonsai process is explicitly restarted. Never replay or reissue a request from the failed generation. Before the 4,096-ID cap, perform an idle-only planned generation restart subject to the same start budget; never wrap IDs.

- [ ] **Step 4: Run GREEN verification**

Run: `npx vitest run lib/codex-app-server/client.test.ts`

Expected: PASS; bounds and backpressure are deterministic, every server request is rejected, and stale generations cannot cross-correlate.

Run: `npx tsc --noEmit -p tsconfig.json && git diff --check`

Expected: both commands exit 0.

Run: `npm run build`

Expected: the repository-mandated production build exits 0 before commit.

- [ ] **Step 5: Commit**

```bash
git add lib/codex-app-server/client.ts lib/codex-app-server/client.test.ts lib/codex-app-server/process.ts
git commit -m "feat: add bounded Codex stdio client"
git push origin copy-b
```

### Task 5: Prove Turn Lifecycle Against an Adversarial Fake Server

**Files:**
- Create: `lib/codex-app-server/completion.ts`
- Create: `lib/codex-app-server/completion.test.ts`
- Create: `lib/codex-app-server/client.integration.test.ts`
- Create: `lib/codex-app-server/test/fake-server.mjs`

**Interfaces:**
- Consumes: `CodexAppServerClient` and stable decoded events from Task 4.
- Produces:

```ts
export interface CodexCompletionInput {
  prompt: string;
  effort: 'low' | 'medium' | 'high' | 'max';
  signal?: AbortSignal;
}

export interface CodexCompletionResult {
  text: string;
  servedBy: string;
  servedEffort: 'low' | 'medium' | 'high' | 'xhigh';
  inputTokens: number;
  outputTokens: number;
}

export class CodexCompletionAdapter {
  constructor(options: {
    client: CodexAppServerClient;
    emptyCwd: string;
    timeoutMs?: number;
    interruptGraceMs?: number;
    maxEvents?: number;
    maxEventBytes?: number;
    maxAnswerBytes?: number;
  });
  complete(input: CodexCompletionInput): Promise<CodexCompletionResult>;
}
```

**Dependencies:** Task 4.

**Risk:** Critical — App Server can begin a dangerous agent action before a terminal response; fail closed on the first prohibited request/item/event and retain the public-release blocker.

The constructor applies defaults of 30 seconds, 2 seconds, 1,024 events, 4 MiB of decoded event payload, and 256 KiB of answer text respectively, while rejecting nonpositive, non-safe, or above-policy overrides.

- [ ] **Step 1: Write the fake server and failing adversarial matrix**

The fake server reads JSONL, checks handshake/method order, and selects one deterministic scenario from an argv value. It must never inherit credentials. Scenarios cover:

- success with response/event interleaving, split lines, a completed `final_answer`, matching latest `tokenUsage.last`, and a matching reroute;
- only null-phase agent messages, with the last completed one selected;
- commentary plus final answer, with commentary excluded;
- benign lifecycle/usage/reroute events for wrong thread or turn, counted against global bounds and ignored rather than attributed;
- every forbidden event type carrying wrong/missing thread and turn IDs, rejected before correlation;
- duplicate/unknown response IDs, malformed/oversized lines, event floods above 1,024, answer text above 256 KiB, stderr floods, early exit, and terminal failure;
- every forbidden item type and every server-request method, including approval, command, file, dynamic tool, MCP, permission, elicitation, attestation, and external-token refresh;
- timeout/abort: `turn/interrupt`, 2-second grace, forced restart, no replay;
- a delayed terminal event from an old generation after restart;
- two concurrent `complete()` calls, with the second rejected as busy before `thread/start`.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npx vitest run lib/codex-app-server/completion.test.ts lib/codex-app-server/client.integration.test.ts`

Expected: FAIL because no completion state machine exists.

- [ ] **Step 3: Implement fresh-thread, one-turn terminal state**

Start every completion with:

```ts
const thread = await client.request('thread/start', {
  cwd: this.emptyCwd,
  approvalPolicy: 'never',
  sandbox: 'read-only',
  ephemeral: true,
  developerInstructions: FIXED_NO_TOOL_INSTRUCTION,
});
```

Do not add `model` or `modelProvider` keys to this object; omission preserves the account default. Require `threadResult.instructionSources` to equal `[]`, returned approval policy to be `never`, returned cwd to equal the canonical fixed cwd, and returned sandbox to be read-only before starting a turn.

Map effort exactly as `{ low: 'low', medium: 'medium', high: 'high', max: 'xhigh' }`. Fetch `model/list` with `{ cursor: null, limit: 100, includeHidden: false }`, follow at most four non-repeating cursors (400 models total), find exactly one default model matching `threadResult.model`, and fail if the mapped effort is not advertised. Then start:

```ts
await client.request('turn/start', {
  threadId,
  input: [{ type: 'text', text: input.prompt, text_elements: [] }],
  cwd: this.emptyCwd,
  approvalPolicy: 'never',
  sandboxPolicy: { type: 'readOnly', networkAccess: false },
  effort: mappedEffort,
});
```

Keep terminal state keyed by generation + thread ID + turn ID. Classify prohibited types globally before correlation; count every decoded event and its bytes, including stale/mismatched benign events, against the generation and active-turn limits. Accept at most 1,024 total events, 4 MiB of decoded event payload, and 256 KiB of final-answer text per active turn. On matching `turn/completed`, require `status === "completed"`, a nonblank final candidate, and a latest matching usage update. Select the last completed `phase: "final_answer"`; only if none exists, select the last completed `phase: null`; never use commentary or deltas as authoritative text. Initialize `servedBy` from `thread/start.result.model` and update only through an internally consistent matching reroute chain.

On abort/30-second timeout, request `turn/interrupt` once if IDs are known. Wait for matching interrupted completion for 2 seconds; otherwise restart the child. The caller receives a failure and the prompt is never replayed.

- [ ] **Step 4: Run GREEN verification**

Run: `npx vitest run lib/codex-app-server/completion.test.ts lib/codex-app-server/client.integration.test.ts`

Expected: PASS for the complete fake-server matrix, with zero API keys/login/live inference.

This GREEN result proves framing, decoding, lifecycle, and fail-closed protocol behavior only. It does not prove that a real 0.145.0 agent avoided a read/process/network side effect before emitting the rejected event.

Run: `npx tsc --noEmit -p tsconfig.json && git diff --check`

Expected: both commands exit 0.

Run: `npm run build`

Expected: the repository-mandated production build exits 0 before commit.

- [ ] **Step 5: Commit**

```bash
git add lib/codex-app-server/completion.ts lib/codex-app-server/completion.test.ts lib/codex-app-server/client.integration.test.ts lib/codex-app-server/test/fake-server.mjs
git commit -m "test: harden Codex turn lifecycle"
git push origin copy-b
```

### Task 6: Gate Local Mutations and Managed ChatGPT Login

**Files:**
- Create: `lib/local-http-security.ts`
- Create: `lib/local-http-security.test.ts`
- Create: `lib/codex-app-server/account.ts`
- Create: `lib/codex-app-server/account.test.ts`
- Create: `lib/codex-app-server/authorization.ts`
- Create: `lib/codex-app-server/authorization.test.ts`
- Create: `lib/codex-app-server/local-host.ts`
- Create: `lib/codex-app-server/local-host.test.ts`
- Create: `app/api/runtime/session/route.ts`
- Create: `app/api/runtime/route.ts`
- Create: `app/api/runtime/route.test.ts`
- Create: `scripts/start-local-preview.ts`
- Create: `scripts/start-local-preview.test.ts`
- Create: `e2e/local-preview-runtime.spec.ts`
- Create: `playwright.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/branch/route.ts`
- Modify: `app/api/merge/route.ts`
- Modify: `app/api/conversation/route.ts`
- Modify: `app/api/reset/route.ts`
- Modify: `app/api/validation.test.ts`

**Interfaces:**
- Consumes: explicit runtime policy, `CodexAppServerClient`, account/rate/model protocol results, and existing POST handlers.
- Produces:

```ts
export interface LocalPreviewSession {
  origin: `http://127.0.0.1:${number}`;
  headerCapability: string;
  cookieCapability: string;
  cookieName: 'bonsai_preview';
}

export interface LocalPreviewListener {
  origin: `http://127.0.0.1:${number}`;
  close(): Promise<void>;
}

export async function startLocalPreview(): Promise<LocalPreviewListener>;

export async function withLocalRuntimeAccess<T>(
  request: Request,
  access: 'status' | 'mutation',
  operation: () => Promise<T>,
): Promise<T>;

export interface RuntimeStatus {
  runtime: RuntimeSelection;
  billing: BillingMode;
  preview: 'disabled' | 'developer-preview';
  connection: 'disconnected' | 'ready' | 'error';
  account: 'not-applicable' | 'signed-out' | 'chatgpt' | 'unsupported-account';
  planType?: string;
  defaultModel?: string;
  rateLimits?: RedactedRateLimits;
  warning?: string;
}

export class CodexAccountManager {
  constructor(options: {
    client: CodexAppServerClient;
    policy: RuntimePolicy;
  });
  status(): Promise<RuntimeStatus>;
  startManagedLogin(): Promise<{ authUrl: string }>;
  cancelManagedLogin(): Promise<void>;
}
```

`CodexRuntimeAuthorization` is an opaque identity created only inside the authorization module and carried through `AsyncLocalStorage`; callers cannot construct it from request data. A generalized Task 6 local-runtime access wrapper validates exact launch nonce, Host, Fetch Metadata, cookie capability, and header capability before entering the authorization scope for either status GET or mutation POST. GET permits an absent Origin but rejects a present nonmatching Origin; POST requires the exact Origin and additionally enforces JSON/body/rate/concurrency policy. The capability-bootstrap session route remains the only pre-capability exception and returns no runtime/account data. `requireCodexRuntimeAuthorization()` throws before host lookup or process construction outside that scope. Tests prove a realistic Origin-absent browser status GET can borrow the host, while every other missing/mismatched GET condition makes zero host/client/account calls.

`local-host.ts` owns a versioned `Symbol.for('bonsai.codex-runtime-host.v1')` registry on `globalThis`. Only `scripts/start-local-preview.ts`, which runs outside the reloadable Next graph, may install the host for its launch nonce. Re-imported route/runtime modules borrow the same host and circuit; they never own child lifecycle. The launcher closes and removes its exact host once when the HTTP server closes or receives a supported termination signal. Tests simulate module cache resets/re-imports and prove one host, one circuit, no duplicate child, and one deterministic cleanup; duplicate/incompatible installs fail closed.

**Dependencies:** Tasks 1, 4, and the account protocol types pinned in Task 2.

**Risk:** Critical — an incomplete localhost gate permits cross-site login/mutation against a user's subscription and local Bonsai state.

- [ ] **Step 1: Write failing HTTP and account-boundary tests**

Install the pinned browser test runner with `npm install --save-dev @playwright/test`, update `package-lock.json`, and install its Chromium binary with `npx playwright install chromium`. Do not drive a user's existing Chrome profile or cookies.

Start an actual test listener and assert `server.address().address === "127.0.0.1"`, its OS-assigned port is nonzero, and its derived origin exactly matches the listener. Test literal Host/Origin equality against that origin; reject `localhost`, IPv6, suffix/prefix hosts, any `Forwarded`/`X-Forwarded-*` header, missing/wrong Origin on mutations, cross-site Fetch Metadata, navigations, non-JSON, CORS preflights, missing/mismatched cookie/header capability, oversized/extra fields, more than one mutation, and more than three login starts per minute. Prove preview routes return disabled outside the dedicated launcher mode.

Add a real Chromium test that starts `npm run dev:local`, navigates to its reported random loopback origin, calls the session bootstrap from page JavaScript with credentials, then performs `GET /api/runtime` with the returned header capability. Assert the browser-normal request succeeds without a synthetic Origin header, the HttpOnly cookie is used, and deleting either capability or sending a present mismatched Origin makes zero runtime-client calls. This complements, rather than replaces, the exact synthetic boundary matrix.

An authorized `GET /api/runtime` must expose no email, login ID, authorization URL, executable path, cwd/home path, raw App Server error, or credentials. A realistic same-origin browser GET may omit `Origin`; if present it must equal the derived loopback origin. Missing/mismatched Fetch Metadata, cookie capability, or header capability—and any present mismatched Origin—returns the safe disabled response and makes zero host/client calls. `POST /api/runtime` requires the exact Origin and accepts exactly `{ action: "start-login" }` or `{ action: "cancel-login" }`; all other keys/actions fail before client calls.

Account tests must reject every non-ChatGPT account and login response. Assert the exact outbound login params:

```ts
expect(client.request).toHaveBeenCalledWith('account/login/start', {
  type: 'chatgpt',
  useHostedLoginSuccessPage: true,
  appBrand: 'chatgpt',
});
```

Validate the returned URL against this docs-current example policy: protocol `https:`, hostname exactly `chatgpt.com`, empty username/password/explicit port/fragment, total length at most 8 KiB, a nonempty absolute path, and exactly one `redirect_uri` query value that parses as `http://localhost:<1-65535>/auth/callback` with no userinfo or fragment. Stable 0.145.0 only proves that `authUrl` is a string, so any authority drift fails closed and requires a fresh schema/docs review before exposure. Retain `loginId` only in private process memory for cancellation/completion matching; return only `{ authUrl }`, set `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and never pass an auth URL to logging.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npx vitest run lib/local-http-security.test.ts lib/codex-app-server/account.test.ts lib/codex-app-server/authorization.test.ts lib/codex-app-server/local-host.test.ts app/api/runtime/route.test.ts app/api/validation.test.ts`

Expected: FAIL because the local security/session/runtime routes and account manager do not exist.

Run: `npx playwright test e2e/local-preview-runtime.spec.ts --project=chromium`

Expected: FAIL because the loopback launcher/session/status browser flow does not exist.

- [ ] **Step 3: Implement the prerequisite gate before enabling runtime POST**

`scripts/start-local-preview.ts` uses a programmatic Next development server and Node HTTP listener bound with `{ host: "127.0.0.1", port: 0, exclusive: true }`; after `listening`, it derives `BONSAI_LOCAL_ORIGIN` from the actual address and sets an unguessable internal launch nonce before serving any request. It never binds `0.0.0.0`, `::`, `localhost`, or a caller-selected address/port. Add `npm run dev:local`; Codex preview documentation must use this command, never plain `npm run dev`.

After the launcher has established the listener, generate independent 32-byte header and cookie capabilities and bind both to its exact origin and launch nonce. `GET /api/runtime/session` is available only to a same-origin CORS-mode empty-destination fetch, returns only the header capability in JSON for in-memory header use, and sets the distinct cookie capability in an HttpOnly, `SameSite=Strict`, path `/` cookie. Emit no permissive CORS headers and `Cache-Control: no-store`.

Every local-preview runtime GET/POST must require the Host, Fetch Metadata, and dual-capability fields below. GET allows `Origin` to be absent but requires an exact match when present; POST requires the shown exact Origin, JSON content type, and its action-specific rate/concurrency checks:

```text
Host: 127.0.0.1:<configured-port>
Origin: http://127.0.0.1:<configured-port>
Sec-Fetch-Site: same-origin
Sec-Fetch-Mode: cors
Sec-Fetch-Dest: empty
Content-Type: application/json
X-Bonsai-Capability: <per-launch header capability>
Cookie: bonsai_preview=<distinct per-launch cookie capability>
```

The HTTP developer preview deliberately does not claim the HTTPS-only `__Host-` cookie property. Secure packaged transport and its stronger cookie attributes remain part of the public-packaging blocker.

Wrap the existing mutation routes with this gate only inside the dedicated launcher mode; keep the existing hosted behavior unchanged and explicitly unsafe for multi-user use. Browser-originated Codex status/login/inference must refuse unless the preview flag, internal launch nonce, exact origin, and capability session are active. Capability/session enforcement is an HTTP boundary concern: the separately opted-in Task 8 local CLI has no browser or HTTP session and constructs the runtime through its own guarded non-HTTP entry point. Do not silently enable Codex in deployed production.

Account status sends `account/read` with `refreshToken: false`; never triggers token refresh. It accepts inference only when `account.type === "chatgpt"`, redacts email, exposes plan type, fetches rate limits, and returns safe disconnected/error categories. Login cancellation uses only the privately held login ID. Browser inputs cannot choose login type, app brand, hosted-success behavior, refresh behavior, method, executable, cwd, sandbox, approval, model, or configuration.

- [ ] **Step 4: Run GREEN verification**

Run: `npx vitest run scripts/start-local-preview.test.ts lib/local-http-security.test.ts lib/codex-app-server/account.test.ts lib/codex-app-server/authorization.test.ts lib/codex-app-server/local-host.test.ts app/api/runtime/route.test.ts app/api/validation.test.ts app/api/persistence/route.test.ts`

Expected: PASS; malformed/cross-origin requests make zero account/inference/store calls, and safe status contains no sensitive fields.

Run: `npx playwright test e2e/local-preview-runtime.spec.ts --project=chromium`

Expected: PASS against the actual random-port `127.0.0.1` listener and browser-generated request headers/cookies.

Run: `npx tsc --noEmit -p tsconfig.json && git diff --check`

Expected: both commands exit 0.

Run: `npm run build`

Expected: the repository-mandated production build exits 0 before commit.

- [ ] **Step 5: Commit**

```bash
git add lib/local-http-security.ts lib/local-http-security.test.ts lib/codex-app-server/account.ts lib/codex-app-server/account.test.ts lib/codex-app-server/authorization.ts lib/codex-app-server/authorization.test.ts lib/codex-app-server/local-host.ts lib/codex-app-server/local-host.test.ts app/api/runtime/session/route.ts app/api/runtime/route.ts app/api/runtime/route.test.ts scripts/start-local-preview.ts scripts/start-local-preview.test.ts e2e/local-preview-runtime.spec.ts playwright.config.ts package.json package-lock.json app/api/chat/route.ts app/api/branch/route.ts app/api/merge/route.ts app/api/conversation/route.ts app/api/reset/route.ts app/api/validation.test.ts
git commit -m "feat: secure local runtime control"
git push origin copy-b
```

### Task 7: Integrate Codex at the Existing Completion Seam

**Files:**
- Modify: `lib/codex-app-server/completion.ts`
- Create: `lib/codex-app-server/runtime.ts`
- Create: `lib/codex-app-server/runtime.test.ts`
- Modify: `lib/codex-app-server/authorization.ts`
- Modify: `lib/codex-app-server/authorization.test.ts`
- Modify: `lib/codex-app-server/local-host.ts`
- Modify: `lib/codex-app-server/local-host.test.ts`
- Modify: `lib/provider.ts`
- Modify: `lib/provider.test.ts`
- Modify: `lib/llm.ts`
- Modify: `lib/llm.test.ts`
- Modify: `lib/router.ts`
- Create: `lib/router.test.ts`
- Modify: `lib/compiler.ts`
- Modify: `lib/compiler.test.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/branch/route.ts`
- Modify: `app/api/merge/route.ts`
- Modify: `app/api/context-flow.test.ts`
- Modify: `app/api/inference-logging.test.ts`
- Modify: `lib/persistence/restart.test.ts`
- Modify: `scripts/start-local-preview.ts`
- Modify: `scripts/start-local-preview.test.ts`
- Modify: `scripts/try-engine.ts`

**Interfaces:**
- Consumes: `CodexCompletionAdapter`, explicit runtime policy, private launcher/client/account manager, and the existing `providerComplete()` / `complete()` flow.
- Produces:

```ts
export interface CodexRuntime {
  complete(params: {
    messages: readonly ProviderMessage[];
    effort: Effort;
    signal?: AbortSignal;
  }): Promise<ProviderResult>;
  status(): Promise<RuntimeStatus>;
  close(): Promise<void>;
}

export function codexRuntime(): CodexRuntime;
export function createCodexRuntimeForLocalAcceptance(options: {
  executable: string;
  authorization: CodexRuntimeAuthorization;
}): Promise<CodexRuntime>;
export function resetCodexRuntimeForTests(): Promise<void>;
```

**Dependencies:** Tasks 1–6.

**Risk:** High — this changes the engine's only inference seam and persisted truth metadata; route transactions must retain their existing failure atomicity.

- [ ] **Step 1: Write failing seam, no-fallback, and persisted-truth tests**

Cover system/user/assistant message rendering into one deterministic prompt; one fresh thread per classifier/compiler/chat/merge completion; no model field; effort mapping; exact final text/usage/model/reroute metadata; `estCostUsd: null` with subscription billing; failed/aborted turns producing no assistant message; same-runtime escalation only; and no mock/API invocation after any Codex authentication, protocol, timeout, version, or process failure. Test both launcher-owned host lookup and the acceptance-only `{ executable, authorization }` factory, including its internally derived data directory, immutable spawn closure, and refusal of absent/stale/wrong-source authorization.

Add a dependency-boundary test over repository imports and package scripts. Only the validated local HTTP wrapper/launcher and `scripts/codex-live-acceptance.ts` may obtain an authorization producer or call a runtime-construction function. Every other script—including `scripts/try-engine.ts`—must fail before launcher/client construction when `BONSAI_RUNTIME=codex`; direct `complete()`/provider imports outside an active authorization scope must do the same.

Add route-level abort cases for classifier, compiler, first answer, the interval between escalation attempts, and merge. Each route passes `request.signal`; an abort makes no later provider call, never starts a second attempt, and commits no assistant message, branch, or merge mutation. A Codex turn already in flight receives one `turn/interrupt`. Completed inference events observed before abort retain the existing atomic transaction semantics.

Add restart/schema tests proving new log rows round-trip `runtime`, `billing`, `servedBy`, and `servedEffort`, while pre-feature rows remain absent rather than being relabeled.

```ts
await expect(complete(codexParams)).rejects.toThrow(ProviderUnavailableError);
expect(mockComplete).not.toHaveBeenCalled();
expect(apiFetch).not.toHaveBeenCalled();
expect(log).toMatchObject({
  runtime: 'codex',
  billing: 'chatgpt-subscription',
  servedBy: 'gpt-served-after-reroute',
  servedEffort: 'xhigh',
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npx vitest run lib/codex-app-server/runtime.test.ts lib/codex-app-server/authorization.test.ts lib/codex-app-server/local-host.test.ts lib/provider.test.ts lib/llm.test.ts lib/router.test.ts lib/compiler.test.ts app/api/context-flow.test.ts app/api/inference-logging.test.ts lib/persistence/restart.test.ts scripts/start-local-preview.test.ts`

Expected: FAIL because the Codex runtime is not wired into `complete()` and persisted events lack the new exact metadata.

- [ ] **Step 3: Implement the process-local singleton and seam integration**

The non-reloadable local launcher constructs the browser runtime host only when explicit policy selects `codex`: resolve the durable location with `resolveFileDataDirectory()`, call `resolveCodexLaunchConfig({ executable, dataDirectory })`, construct `CodexAppServerClient({ spawn: () => spawnCodexAppServer(launchConfig) })`, then create the account manager and Task 5 adapter with `client`, `emptyCwd: launchConfig.emptyCwd`, and the fixed policy bounds. Install that object once in the launch-nonce-owned Task 6 registry before accepting Codex mutations. `codexRuntime()` only verifies the current opaque authorization scope and borrows the installed host; it never constructs a child from a reloadable route/provider module. Require a ready ChatGPT account before `thread/start`. Render existing `LlmMessage[]` in order with unambiguous role delimiters into the single text item; do not add store state, filesystem content, hidden conversation history, browser data, or credentials.

HMR/re-import tests reset the route/runtime module cache during and between turns and prove the same host, child generation, rolling restart circuit, and authorization policy remain in force. Reloaded modules must not register process signal handlers, own cleanup, or close the host. Closing the launcher terminates the process group and host exactly once; stale borrowers fail closed afterward.

Pass Bonsai effort to the adapter and preserve both Bonsai `effort` and mapped `servedEffort`. Return exact usage from `tokenUsage.last`; do not let the existing estimate fallback run for the Codex path. Return actual `servedBy`. Mark `mock: false`, `runtime: "codex"`, and `billing: "chatgpt-subscription"`; return `estCostUsd: null` and do not compute a catalog cost because Codex omitted the requested model.

Add `signal?: AbortSignal` to `CompleteParams`, provider parameters, router `RouteParams`, compiler `CompileParams`, `completeWithEscalation()` parameters, and merge distillation. Pass the signal through `complete()` to `providerComplete()` and the selected runtime. API-provider fetches combine caller cancellation with the adapter timeout. Every route passes `request.signal` to every inference call. Check cancellation before classification, compilation, distillation, and the second escalation attempt; cancellation is terminal and must not trigger fallback, retry, or runtime crossover.

Keep router escalation behavior within `completeWithEscalation()`: if a Codex answer fails the existing quality check, the second attempt is another fresh Codex thread through the same explicitly selected runtime. No attempt may change runtime. On Codex failure, throw `ProviderUnavailableError` through existing safe 502 handling; do not call mock or any API provider.

The isolated Task 8 acceptance factory requires its opaque live-acceptance authorization, creates its own validated client/account/adapter stack, and returns an owner that the CLI closes in `finally`; it never installs the browser host. Reject detached work and preserve the no-assistant-message transaction behavior already proved by route tests.

- [ ] **Step 4: Run GREEN verification**

Run: `npx vitest run lib/codex-app-server/runtime.test.ts lib/codex-app-server/completion.test.ts lib/codex-app-server/authorization.test.ts lib/codex-app-server/local-host.test.ts lib/provider.test.ts lib/llm.test.ts lib/router.test.ts lib/compiler.test.ts app/api/context-flow.test.ts app/api/inference-logging.test.ts app/api/persistence/route.test.ts lib/persistence/restart.test.ts scripts/start-local-preview.test.ts`

Expected: PASS with fake App Server only; runtime failure stays a safe 502 and never crosses providers.

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run lint && git diff --check`

Expected: all commands exit 0.

Run: `npm run build`

Expected: the repository-mandated production build exits 0 before commit.

- [ ] **Step 5: Commit**

```bash
git add lib/codex-app-server/completion.ts lib/codex-app-server/runtime.ts lib/codex-app-server/runtime.test.ts lib/codex-app-server/authorization.ts lib/codex-app-server/authorization.test.ts lib/codex-app-server/local-host.ts lib/codex-app-server/local-host.test.ts lib/provider.ts lib/provider.test.ts lib/llm.ts lib/llm.test.ts lib/router.ts lib/router.test.ts lib/compiler.ts lib/compiler.test.ts app/api/chat/route.ts app/api/branch/route.ts app/api/merge/route.ts app/api/context-flow.test.ts app/api/inference-logging.test.ts lib/persistence/restart.test.ts scripts/start-local-preview.ts scripts/start-local-preview.test.ts scripts/try-engine.ts
git commit -m "feat: route completions through Codex"
git push origin copy-b
```

### Task 8: Add an Opt-In One-Turn Live Acceptance Gate

**Files:**
- Create: `scripts/codex-live-acceptance.ts`
- Create: `scripts/codex-live-acceptance.test.ts`
- Modify: `lib/codex-app-server/authorization.ts`
- Modify: `lib/codex-app-server/authorization.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the production `CodexRuntime` and redacted status interfaces; no separate authentication or transport implementation.
- Produces: `npm run acceptance:codex-live`, guarded by `BONSAI_CODEX_LIVE_ACCEPTANCE=1`, `BONSAI_LOCAL_PREVIEW=1`, `BONSAI_RUNTIME=codex`, and absolute `BONSAI_CODEX_EXECUTABLE`.

**Dependencies:** Task 7.

**Risk:** High — this is the only planned live inference and must remain impossible without explicit operator opt-in.

- [ ] **Step 1: Write failing gate/output tests with a fake runtime**

```ts
it('refuses without the exact live opt-in', async () => {
  const withAuthorization = vi.fn();
  const createRuntime = vi.fn(() => fakeRuntime);
  await expect(runAcceptance(
    { BONSAI_CODEX_LIVE_ACCEPTANCE: '0' },
    { withAuthorization, createRuntime },
  ))
    .rejects.toThrow('live Codex acceptance is not enabled');
  expect(withAuthorization).not.toHaveBeenCalled();
  expect(createRuntime).not.toHaveBeenCalled();
});

it('prints only redacted acceptance facts', async () => {
  const output = await runAcceptance(fullyOptedInEnv, {
    withAuthorization: (_env, work) => work(fakeAuthorization),
    createRuntime: ({ authorization }) => {
      expect(authorization).toBe(fakeAuthorization);
      return fakeRuntime;
    },
  });
  expect(output).toContain('billing: chatgpt-subscription');
  expect(output).toContain('served model: gpt-test');
  expect(output).not.toMatch(/email|loginId|authUrl|accessToken|refreshToken|CODEX_HOME|auth\.json/i);
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `npx vitest run scripts/codex-live-acceptance.test.ts`

Expected: FAIL because the acceptance runner does not exist.

- [ ] **Step 3: Implement the explicit live gate**

Before any account or inference call, print the developer-preview warning: App Server 0.145.0 lacks restricted readable-root/all-tools-off proof; this uses the signed-in ChatGPT account and may consume plan limits or credits; no per-turn invoice amount is available; public packaging is blocked. Require the exact opt-ins and a managed ChatGPT account already present in Bonsai's dedicated home. Do not initiate login, inspect credentials, or accept a key.

The CLI has no browser or HTTP session. `withLiveCodexAcceptanceAuthorization(env, work)` validates every exact opt-in and the absolute executable before creating a fresh opaque live-acceptance authorization; it then invokes `work(authorization)` inside a bounded scope. Only there may the runner lazily call `createCodexRuntimeForLocalAcceptance({ executable, authorization })`. The factory derives the file data directory and validated launch configuration itself, accepts no other runtime configuration from CLI input, and bypasses only the Task 6 HTTP capability gate—not account, process, protocol, or sandbox checks. Tests prove authorization and runtime factories are never constructed before every guard succeeds, and the dependency-boundary test rejects imports of the live authorization producer from any other script.

Send one bounded prompt asking for a short fixed acknowledgement with no filesystem/network/tool work. Assert a nonblank response, `billing === "chatgpt-subscription"`, a nonblank served model, mapped effort, positive exact token usage, and a redacted rate-limit snapshot. Print only pass/fail, served model, served effort, input/output token counts, billing mode, and rate-limit percentages/reset times. Never print response text, account email, login IDs, authorization URLs, paths, raw errors, or JSONL.

Add `"acceptance:codex-live": "tsx scripts/codex-live-acceptance.ts"`; do not reference it from `test`, `build`, fixture scripts, or CI.

- [ ] **Step 4: Run fake-only GREEN verification**

Run: `npx vitest run scripts/codex-live-acceptance.test.ts`

Expected: PASS without login or live inference.

Run: `npm run build`

Expected: the repository-mandated production build exits 0 before commit.

Manual, user-opted acceptance after managed login:

```bash
BONSAI_CODEX_LIVE_ACCEPTANCE=1 \
BONSAI_LOCAL_PREVIEW=1 \
BONSAI_RUNTIME=codex \
BONSAI_CODEX_EXECUTABLE="$(command -v codex)" \
npm run acceptance:codex-live
```

Expected: one PASS record with `billing: chatgpt-subscription`, nonblank served model/effort, positive exact input/output tokens, and redacted rate limits. If the user has not explicitly opted in or the dedicated instance is signed out, do not run this command; report the skipped acceptance truthfully.

- [ ] **Step 5: Commit**

```bash
git add scripts/codex-live-acceptance.ts scripts/codex-live-acceptance.test.ts lib/codex-app-server/authorization.ts lib/codex-app-server/authorization.test.ts package.json
git commit -m "test: add Codex live acceptance gate"
git push origin copy-b
```

### Task 9: Verify the Milestone, Then Document the Preview Boundary

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/BUILD_LOG.md`

**Interfaces:**
- Consumes: all verified behavior from Tasks 1–8 and the actual live-acceptance result, including an explicit skipped result.
- Produces: operator instructions and durable build evidence that do not overstate sandboxing, billing, hosted security, or live verification.

**Dependencies:** Tasks 1–8 must be implemented and pass the non-live gate.

**Risk:** Medium — documentation can easily overstate a fake-only or best-effort security result.

- [ ] **Step 1: Run the complete non-live gate before editing docs**

Run:

```bash
npm test
npx tsc --noEmit -p tsconfig.json
npm run lint
BONSAI_CODEX_EXECUTABLE="$(command -v codex)" npm run codex:schema:check
npx playwright test e2e/local-preview-runtime.spec.ts --project=chromium
npm run build
git diff --check
```

Expected: all commands exit 0; schema output names 0.145.0, confirms generation without `--experimental`, and says the public-release sandbox remains blocked.

- [ ] **Step 2: Run security-focused scans**

Run:

```bash
rg -n "apiKey|chatgptAuthTokens|accessToken|refreshToken: true|account/logout|thread/resume|thread/fork|fs/|command/exec|mcpServer/" lib/codex-app-server app/api/runtime scripts/codex-live-acceptance.ts
rg -n "console\.(log|warn|error)|process\.env|\.\.\.process\.env|NODE_OPTIONS|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY" lib/codex-app-server app/api/runtime scripts/codex-live-acceptance.ts
```

Expected: the first scan finds forbidden protocol names only in explicit rejection tests/schema evidence; `refreshToken: true` and credential-bearing production requests have zero matches. The second finds process environment access only in the validated process-start configuration boundary and console output only in the redacted acceptance CLI.

- [ ] **Step 3: Update documentation only from observed evidence**

Document:

- explicit `BONSAI_RUNTIME`, mock default, matching API key requirements, and no cross-runtime fallback;
- managed ChatGPT browser login inside the dedicated Bonsai home, with no copying/reading of ordinary Codex credentials;
- literal loopback origin, preview/capability requirements, and the fact that existing hosted mutation routes are not a secure multi-user surface;
- subscription billing language and modeled catalog-cost language;
- schema version 0.145.0 and the docs-current/stable-contract distinction;
- fake-server/schema commands and the separately opted-in live command;
- exact public-release blockers from this plan.

Because repository hooks prohibit agents from reading or writing `.env*`, document safe shell examples in `README.md` instead of editing `.env.example`: `BONSAI_RUNTIME=mock`, `BONSAI_LOCAL_PREVIEW=0`, and `BONSAI_CODEX_EXECUTABLE=/absolute/path/to/codex`. Document `npm run dev:local` as the only Codex browser-preview launcher: it chooses a random loopback port and derives the actual origin internally, so operators must not set a static `BONSAI_LOCAL_ORIGIN`. Include no capability, token, key, login ID, auth URL, or credential path.

Record the live gate as `passed` only if Task 8 was explicitly run and produced the required facts; otherwise record `skipped — no user opt-in/live inference performed`. Never infer a pass from fake tests.

- [ ] **Step 4: Re-run the full final gate**

Run:

```bash
npm test
npx tsc --noEmit -p tsconfig.json
npm run lint
BONSAI_CODEX_EXECUTABLE="$(command -v codex)" npm run codex:schema:check
npx playwright test e2e/local-preview-runtime.spec.ts --project=chromium
npm run build
git diff --check
git status --short
```

Expected: all verification commands exit 0; status contains only the three intended documentation files before commit.

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md docs/BUILD_LOG.md
git commit -m "docs: document Codex developer preview"
git push origin copy-b
```

## Final Review Checklist

- [ ] Every new completion and inference log records explicit runtime and billing; legacy rows retain absent metadata.
- [ ] A provider key never selects a runtime, and failure never crosses runtime boundaries.
- [ ] Outbound methods exactly match the ten-entry allowlist, including `initialized`; no experimental schema generation flag or capability is used.
- [ ] The child uses private stdio, one active turn, bounded resources, exact response IDs/generations, backpressure, grace/kill/restart, and no replay.
- [ ] Numeric protocol fields reject non-finite, fractional integer, negative, unsafe, and out-of-range values before they affect accounting, pagination, or rate-limit state.
- [ ] The executable and directories are canonical/private/owned; the environment is constructed from scratch and excludes keys, DB/KV, `NODE_OPTIONS`, proxy variables, npm variables, and `PATH`.
- [ ] Bonsai never reads/copies ordinary Codex auth and accepts only managed ChatGPT browser login in its dedicated home.
- [ ] Account status is redacted; login response exposes only a controlled auth URL; login ID remains private.
- [ ] Every server request, approval, command/file/tool/MCP/fs/token-refresh event, non-empty instruction source, and mismatched lifecycle event fails closed.
- [ ] Prohibited events are rejected before correlation, and every decoded line/event counts against global generation bounds even when IDs are stale, missing, or wrong.
- [ ] Every completion uses a fresh ephemeral thread, fixed empty cwd, never approvals, stable read-only/no-network policy, omitted model, mapped effort, terminal final text, latest matching usage, and served model/reroutes.
- [ ] Local mutation/login remains disabled without exact loopback Host/Origin, Fetch Metadata, JSON, cookie, header capability, rate, and concurrency checks.
- [ ] Runtime status GET requires the same launch/Host/Fetch-Metadata/dual-capability scope, permits browser-normal absent Origin but rejects a present mismatch, and makes zero host/client calls when unauthorized; only the empty capability bootstrap is pre-capability.
- [ ] Real Chromium proves bootstrap-to-status against the actual random loopback listener without using a user browser profile; synthetic Request tests still cover every negative boundary.
- [ ] The dedicated browser preview listens only on literal `127.0.0.1` with an OS-assigned port; restart circuits/backoff and whole-process-tree termination are verified.
- [ ] Only the non-reloadable launcher or exact live-acceptance guard can authorize runtime construction; route HMR reuses one host/circuit and launcher teardown closes it once; ordinary scripts cannot spawn Codex.
- [ ] Caller abort propagates from every inference route through compiler/router/LLM/provider/runtime, interrupts an active Codex turn, stops escalation, and preserves transaction atomicity.
- [ ] Fake adversarial tests and schema drift run without credentials/live inference; live acceptance remains separate and opt-in.
- [ ] README, AGENTS, and BUILD_LOG change only after verified implementation, and make no public-release or hosted-security claim; `.env*` files remain untouched.
- [ ] Public-release blockers remain open until stable restricted reads/tool denial, OS sandboxing, and adversarial proof exist.

## Self-Review Record

- Spec coverage: all Codex runtime, authentication, failure, accounting, persistence-compatibility, local HTTP, fake-server, schema-drift, and live-acceptance requirements map to Tasks 1–9. Context-engine, storage-backend, responsive UI, and extension work are intentionally outside this milestone because they already have separate milestones or are future surfaces. The binding scope deliberately defers the full runtime-control/status UI to the responsive UI milestone; Task 1 changes only existing economics wording/types for truthfulness, so this plan does not claim to complete the approved product UI story.
- Placeholder scan: the plan contains no deferred implementation markers; every task names exact files, interfaces, RED/GREEN commands, expected results, and a commit.
- Type consistency: `RuntimeSelection`, `BillingMode`, `RuntimeStatus`, `CodexLaunchConfig`, `CodexAppServerClient`, `CodexCompletionAdapter`, and `CodexRuntime` are defined once and consumed by later tasks with the same names and field meanings.
- Security posture: dedicated state and fail-closed event handling reduce exposure but do not solve stable 0.145.0's broad read boundary. Developer preview and public-release blockers are explicit throughout.
