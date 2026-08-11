# Bonsai Local Runtime Design

Date: 2026-08-11
Lane: copy-b
Status: approved by Tarun's autonomous-build direction

## Decision

Bonsai will become a local-first context runtime with thin clients.

The current Next.js app remains the reference UI and engine testbed. The first real provider is the official Codex App Server over private stdio, using Codex's managed ChatGPT authentication. Existing developer API providers and the mock remain supported, but provider selection and fallback become explicit.

Bonsai will not wrap Claude Free, Pro, Max, Team, or Enterprise consumer OAuth. Anthropic explicitly reserves consumer OAuth for native Anthropic products and requires third-party products to use API keys. A future Claude surface may be a native Claude Code plugin or an Anthropic API provider, but never a consumer-token bridge.

Chrome and MCP clients remain future thin surfaces. Neither owns inference or context state.

## Product boundary

The durable product is:

1. A tree of conversations.
2. An immutable context snapshot at every fork.
3. Provenance for every fact included in that snapshot.
4. Selective insight merge-back that changes future prompts.
5. Explicit provider, model, effort, token, and outcome accounting.

The product is not a browser DOM overlay, a model picker, or a hosted shared chat demo.

## First complete user story

A user launches Bonsai locally without an API key, sees their official Codex account state, sends a root message, branches with a pruned context brief, explores, merges one insight, then creates a nested branch.

The nested branch must:

- inherit the stored parent brief;
- see the merged ancestor insight;
- see relevant parent-branch turns;
- exclude unrelated root transcript;
- persist the exact source manifest used to compile it;
- survive an application restart;
- show the actual provider and model that served each inference.

This flow is the first release gate.

## Architecture

### Context engine

Add a single context boundary in lib/context.ts.

ContextSourceRef records:

- kind: profile, brief, message, or insight;
- conversationId;
- sourceId.

AssembledContext records:

- rendered markdown;
- ordered source references;
- token estimate.

assembleVisibleContext(conversationId) has exact semantics:

- Root: profile, root messages, and insights merged into the root.
- Branch: its immutable stored brief, its own messages, and insights merged into it.
- Nested fork: compile from the parent's assembled visible context, never parent.messages alone.

ContextBrief stores both the rendered markdown and the source manifest. Existing briefs are immutable. Later merges affect future turns and future forks, but never rewrite what an existing branch originally inherited.

Every chat, compile, and merge prompt goes through this boundary. Tests assert the exact rendered prompt and ordered source IDs.

### Merge semantics

A merge creates one evidence-backed Insight on the direct parent.

Insight gains source message IDs and an active/revoked lifecycle. The parent context assembler includes active insights in future turns and forks. Archive remains independent from merge so a branch can be merged without becoming inaccessible.

The first release does not implement automatic conflict resolution. Conflicting active insights are rendered with provenance and exposed to the model as competing evidence.

### Provider runtime

Keep complete() as the engine's only completion seam.

Add a Codex App Server adapter:

- lib/codex-app-server/client.ts: long-lived child process, newline-delimited JSON-RPC, initialization, request correlation, bounded queues, cancellation, stderr sanitization, restart-on-exit, and cleanup;
- lib/codex-app-server/completion.ts: converts Bonsai prompts into App Server thread/start and turn/start calls and returns the final agent message plus usage;
- app/api/runtime/route.ts: safe account, login, provider, and rate-limit status;
- a small runtime control in the UI.

Each Bonsai inference creates a fresh ephemeral Codex thread. Bonsai sends only the assembled prompt for that inference. It never resumes or forks a Codex thread, so hidden Codex history cannot contaminate Bonsai's claimed context boundary.

Thread settings:

- fixed dedicated empty working directory;
- ephemeral history;
- read-only sandbox;
- approval policy never;
- no environments, dynamic tools, MCP tools, or capability roots;
- no experimental App Server methods;
- account-default Codex model initially;
- Bonsai controls reasoning effort only;
- actual returned model is recorded as servedBy.

The child is spawned with a resolved executable, argv, shell false, a minimal environment, and stdio transport. Browser clients never connect to App Server directly and never see ChatGPT credentials.

App Server is still an experimental coding-agent boundary, and read-only mode does not by itself prove that prompt-injected content cannot read local data. The first integration is therefore a local developer preview. Public packaging is blocked until an OS-level deny-by-default sandbox is verified on every supported platform.

### Provider policy

Provider choice is explicit per local session:

1. Codex App Server when selected and authenticated.
2. A selected developer API provider when configured.
3. Clearly labeled mock mode.

Authentication or provider failure is returned as a visible error. Bonsai must never silently send content to a different external provider. Automatic retry is allowed only within the same selected provider and is logged.

Existing mock-first development remains: tests and the demo run without accounts or keys.

### Persistence

Local Bonsai state is authoritative. Codex ephemeral threads do not retain conversation state.

Keep store.ts's public engine operations while adding a small persistence backend:

- .bonsai/manifest.json for schema version and root metadata;
- .bonsai/conversations/<id>.json for independently recoverable nodes;
- .bonsai/inference-log.jsonl for append-only inference events;
- serialized writes and atomic temporary-file rename;
- explicit migration functions by schema version.

The current Neon snapshot backend remains only for the hosted demo. Memory remains the test and last-resort backend. Persistence mode and degradation are visible; a configured backend may not fail silently.

This first local runtime is explicitly single-user. Hosted multi-user release is blocked until authentication, per-user storage partitions, ownership checks, CSRF controls, rate limits, and concurrency control exist.

### Local HTTP boundary

The browser uses the same-origin Next.js backend, which alone owns the App Server child.

State-changing local routes require:

- exact loopback Host and Origin validation;
- application/json;
- Fetch Metadata checks;
- bounded schema validation;
- per-session concurrency limits;
- a random per-launch capability established in an HttpOnly, SameSite=Strict cookie.

The launcher binds loopback only and uses a random available port. No route accepts executable paths, working directories, sandbox settings, approval settings, commands, App Server thread IDs, or credentials from the browser.

### UI

The reference UI must make truth visible:

- current runtime: Codex, API provider, or Mock;
- authentication and rate-limit state;
- actual served model;
- compiled-context source list and token count;
- merged insight provenance;
- persistence mode and errors.

The fixed 400-pixel mobile layout is a release blocker and will become a responsive tree drawer.

## Rejected primary approaches

### Chrome overlay first

Useful later as a capture and navigation surface, but it cannot prove token pruning when the host chat still receives its own linear history. DOM coupling, provider-cookie handling, and localhost security also make it a weak engine foundation.

### MCP App first

Useful later as a portable UI. MCP sampling is deprecated in the current protocol, so an MCP App cannot independently obtain pruned completions from a host subscription. It still needs the Bonsai runtime.

### Claude subscription bridge

Rejected. It violates Anthropic's published third-party OAuth restriction and would be fragile even if browser session scraping appeared to work.

### Premature desktop shell or monorepo

Rejected for the first milestones. The existing Next.js process can own the local runtime. A signed desktop shell becomes useful only when installation, updates, stronger OS sandboxing, and native extension pairing justify it.

## Failure behavior

- Codex executable missing: disconnected state with installation guidance.
- Codex unauthenticated: explicit sign-in state; no hidden fallback.
- Child exit: fail affected calls, restart once, preserve Bonsai state.
- Turn timeout or cancellation: interrupt the App Server turn, record failure, do not append an assistant message.
- Malformed protocol message: reject it, sanitize diagnostics, restart after a bounded threshold.
- Compiler output invalid: deterministic minimal fallback with source references, visibly marked degraded.
- Persistence write failure: keep the last durable revision, return an error, and never claim success.
- Corrupt conversation file: quarantine only that node and surface recovery guidance; do not overwrite it.

## Verification

Unit tests:

- path traversal and source ordering;
- merged insight inclusion;
- nested brief inheritance;
- immutable branch snapshots;
- excluded unrelated messages;
- compiler fallback provenance;
- exact prompt rendering;
- inference accounting including classifiers and retries;
- persistence migration and atomic restart recovery.

Protocol tests with a fake App Server:

- initialize ordering;
- concurrent request correlation;
- allowed-method enforcement;
- streaming assembly;
- completion and usage extraction;
- timeout, cancellation, child exit, and restart;
- no cross-provider fallback.

End-to-end tests:

- local runtime status and stub sign-in;
- root chat, branch, merge, nested branch;
- restart survival;
- responsive desktop and mobile flows;
- CSRF and invalid-origin rejection.

Live acceptance:

- one real Codex App Server turn through the user's managed ChatGPT login;
- captured served model and rate-limit state;
- no API key or auth token read by Bonsai.

## Milestones

1. Truthful core: characterization tests, context assembler, merge semantics, immutable provenance, correct accounting.
2. Local durability: file backend, migrations, restart recovery, explicit persistence state.
3. Codex runtime: hardened stdio client, managed login/status, ephemeral completions, live acceptance.
4. Product UX: provider onboarding, context inspector, merge provenance, responsive layout, error recovery.
5. Thin surfaces: native Claude Code integration research, Chrome side panel paired to the local runtime, then MCP App.
6. Public hardening: packaging, signed updates, stronger OS isolation, export/delete, threat-model closure, open-source documentation.

## Sources

- OpenAI Codex App Server: https://developers.openai.com/codex/app-server
- OpenAI Codex non-interactive mode: https://developers.openai.com/codex/non-interactive-mode
- Anthropic legal and compliance: https://code.claude.com/docs/en/legal-and-compliance
- Anthropic Claude Code CLI: https://docs.anthropic.com/en/docs/claude-code/cli-usage
- MCP architecture: https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture
- MCP Apps overview: https://modelcontextprotocol.io/extensions/apps/overview
