# @bonsai/engine

The core of [Bonsai](https://github.com/TarunYadgirkar/Bonsai): a dependency-free, TypeScript
tree-chat engine. It models a conversation as a tree, compiles the smallest self-contained
**context brief** for a branch from the path above its fork (instead of copying the parent's
transcript), routes each branch to a model + reasoning effort with a coverage-aware classifier,
escalates context-first when an answer punts, and personalizes routing with a **learning router**
that reads your overrides, escalations, and merges. Inference is a single injectable seam — the
engine never calls a model directly, so the same code runs live (Anthropic / OpenAI / xAI) or on
an extractive mock with real token math and zero keys.

## Install / status

This is currently a **workspace / vendored package**, not a standalone npm publish. Inside this
repo it is consumed as `@bonsai/engine` via npm workspaces, and Next.js compiles it from TS source
(`transpilePackages` in `next.config.ts`); the Chrome extension bundles it with esbuild. Its
`exports`/`types` intentionally point at `./src/index.ts` — the TS source — which is what makes the
workspace build green without a build step.

**Importing it standalone (outside a bundler that transpiles TS) is a known open step, tracked in
`PRODUCT.md`:** publishing would need a build (compiled `dist/` + `exports` conditions for
`import`/`types`). Until then, use it inside the workspace, or through a bundler that handles TS
(esbuild, Vite, Next).

Zero runtime dependencies. Node `>=18`.

## Usage

The engine takes a `CompleteFn` as a dependency. `complete` is the bundled one (live provider when
a key is set, extractive mock otherwise); inject your own to control inference.

```ts
import {
  assemblePath,
  compileBrief,
  route,
  completeWithEscalation,
  complete, // the built-in inference seam: live provider (if a key is set) → extractive mock
  type CompleteFn,
} from '@bonsai/engine';

const deps = { complete }; // swap `complete` for any CompleteFn to control inference

// 1. Compile a minimal brief from the assembled path above a fork.
//    `assemblePath` renders parent brief + merged insights + anchored transcript.
const path = assemblePath({ parent, byId }); // byId: (id) => Conversation | undefined
const { brief } = await compileBrief(
  {
    briefId: 'brief-1',
    branchId: 'branch-1',
    pathMarkdown: path.markdown,
    selection: 'Free Ventures applications',
    question: 'When do applications close?',
    availableTokens: path.tokens,
  },
  deps,
);

// 2. Route the branch: one cheap classifier call judges complexity AND whether the
//    brief covers the question, then picks a model + effort.
const routing = await route(
  { question: 'When do applications close?', brief, contextTokens: brief.briefTokens },
  deps,
);

// 3. Answer with the context-first escalation ladder: widen the brief with parent
//    turns before ever upgrading the model; never override a manual pick.
const { text, routing: finalRouting } = await completeWithEscalation(
  {
    routing,
    systemPrompt: 'Answer only from the brief; say so plainly if it does not cover the question.',
    userPrompt: `${brief.markdown}\n\n---\nWhen do applications close?`,
    widen: () => null, // return { userPrompt, addedTokens } to pull in more parent context, or null
  },
  deps,
);
```

## API surface

Everything is re-exported from `src/index.ts`. The main pieces:

- **Types** (`./types`) — `Conversation`, `Message`, `ContextBrief`, `RoutingDecision`, `Insight`,
  `UserProfile`, `Tier`, `Effort`, `ModeSelection`, and the rest of the shared engine contract.
- **Tree** (`./tree`) — `buildTree`, `depthOf`, `availableTokensFor`, `lastTier`,
  `type ConversationLookup`.
- **Path & compile** (`./context`, `./compiler`) — `assemblePath`, `profileFor`,
  `renderChatContext`, `widenedChatContext`, `compileBrief` (`CompileParams`, `CompileResult`,
  `EngineDeps`).
- **Routing & escalation** (`./router`) — `route`, `completeWithEscalation`,
  `answerFailsSanityCheck` (`RouteParams`, `RouterDeps`, `EscalationParams`, `EscalationResult`).
- **Learning router** (`./learning`) — `recordFeedback`, `adjustForProfile`, `normalizeProfile`,
  `emptyProfile`, `profileSummary`, `type RoutingProfile`, `RoutingFeedback`, `FeedbackKind`.
- **Inference seam** (`./llm`) — `complete`, `type CompleteFn`, `CompleteParams`, `CompleteResult`,
  `LlmMessage`.
- **Providers** (`./provider`) — `providerComplete`, `providerName`, `isLiveProvider`,
  `providerSummary`, `anthropicBody`.
- **Models & pricing** (`./models`) — `MODELS`, `modelSpec`, `MODEL_PRICING`, `estimateCostUsd`,
  `costForModel`, `routingLabel`, `tierFor`, `effortSpec`, and the tier/effort tables.
- **Tokens** (`./tokens`) — `estimateTokens`, `messagesTokens`, `prunedPct`.

## Tests

Unit tests live in `packages/engine/test` (`npm run test` from the repo root). The end-to-end
evals that prove the moat — referent resolution through composed briefs, coverage flagging,
routing thresholds, distillation, the learning router — are in `evals/` (`npm run eval`).
