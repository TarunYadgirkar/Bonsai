# Changelog

All notable changes to `bonsai-engine` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Provider resilience**: 5xx, 529 and short-`Retry-After` 429 responses are retried with
  backoff; a quota 429 or a 404 steps down one model rung before the mock. Every attempt shares
  the per-effort time budget a single call had. `RoutingDecision.fellBackFrom` and
  `CompleteResult.fellBackFrom` name the upstream that refused.
- **Gemini provider** (`GEMINI_API_KEY`, lowest precedence) over REST `generateContent`, with
  `BONSAI_MODEL_GEMINI_<RUNG>` overrides and Gemini rates verified 2026-10-18.
- **Compile student hook**: `BONSAI_COMPILE_BASE_URL` + `BONSAI_COMPILE_MODEL` send compile calls
  only to an OpenAI-compatible server. Off by default. The URL must be https (plain http only on
  loopback), a reply that is not the compiler's JSON falls back to the provider chain, and
  student compiles are logged at $0.
- `ContextBrief.imported`: a brief carried in from a garden file. `assemblePath` and
  `renderChatContext` frame it as untrusted reference text under its own heading and do not pin
  its facts verbatim into the next brief.
- `COMPILER_SYSTEM_PROMPT` is exported so the distillation project can pin its copy to it.

## [0.1.0] - 2026-08-11

Initial release of the Bonsai conversation engine — a dependency-free, TypeScript core that treats
a conversation as a tree rather than a transcript.

### Added

- **Tree model** — a conversation is a node with a parent; `buildTree`, `depthOf`, `lastTier`, and
  `availableTokensFor` give branches structure and a per-branch token budget.
- **Path assembly** — `assemblePath` renders the smallest self-contained context above a fork
  (parent brief + merged insights + anchored transcript) instead of copying the parent thread;
  `renderChatContext` / `widenedChatContext` widen it on demand.
- **Salience compiler** — `compileBrief` distills a branch's path into a minimal, self-contained
  context brief keyed to the selection and question, with honest token accounting and a heuristic
  fallback when the model output is unparseable.
- **Coverage-aware router** — `route` runs one cheap classifier that judges complexity *and*
  whether the brief covers the question, then picks a model + reasoning effort;
  `completeWithEscalation` climbs a context-first ladder (widen the brief before upgrading the
  model) and never overrides a manual pick.
- **Learning router** — `recordFeedback` / `adjustForProfile` personalize routing from a user's
  overrides, escalations, and merges, folded into a normalizable `RoutingProfile`.
- **Injectable inference seam** — `complete` chains a live provider (Anthropic / OpenAI / xAI, one
  key selects it) to an extractive mock with real token math, so the same code runs live or with
  zero keys; every live failure degrades to the mock (`providerComplete` returns `null`).
- **Honest stats** — `sessionStats`, `savingsCurve`, and the measured/estimated figures price each
  answer by the upstream that actually served it, never by the label on screen.
- **Injectable logger** — `setEngineLogger` / `silenceEngine` let a host redirect or mute the
  engine's fallback warnings; the default remains `console`.

### Packaging

- Publish-time build via `tsup`: `src/index.ts` → `dist/index.js` (ESM) + `dist/index.d.ts`,
  with sourcemaps. Node `>=20.3` at runtime (`AbortSignal.any`). `prepublishOnly` runs the build, and `publishConfig.exports`
  points the published tarball at `dist/`. The workspace continues to resolve the TS source
  (`exports` → `./src/index.ts`), so no build step is needed in-repo.
