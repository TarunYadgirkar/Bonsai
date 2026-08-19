# Changelog

All notable changes to `bonsai-engine` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
