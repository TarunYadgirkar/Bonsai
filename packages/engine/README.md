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

Not on npm yet. Once it is:

```sh
npm install @bonsai/engine
```

Today, clone the monorepo and consume the workspace package:

```sh
git clone https://github.com/TarunYadgirkar/Bonsai && cd Bonsai && npm install
```

Inside this repo it is consumed via npm workspaces, and Next.js compiles it from TS source
(`transpilePackages` in `next.config.ts`); the Chrome extension bundles it with esbuild. The
top-level `exports`/`types` point at `./src/index.ts` on purpose — that keeps the workspace build
green with no build step.

**To publish it standalone:** `cd packages/engine && pnpm publish`. `prepublishOnly` runs `tsup` to
emit a typed `dist/` (ESM `dist/index.js` + `dist/index.d.ts`), and `publishConfig` swaps `exports`/
`types` to `dist` in the published tarball — so bundler-less consumers (`node`, `tsc`, webpack) get
compiled JS + types while the workspace keeps using the source. (Use `pnpm publish`; npm does not
honor the `publishConfig` field-swap.) `npm run build` in the package produces `dist/` on demand.

Zero runtime dependencies. Node `>=20.3` (`AbortSignal.any`).

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
  type Conversation,
} from '@bonsai/engine';

const deps = { complete }; // swap `complete` for any CompleteFn to control inference

// A minimal parent to fork from. Real hosts persist these; the engine only needs the shape.
const parent: Conversation = {
  id: 'root',
  title: 'Accelerator research',
  parentId: null,
  messages: [
    { id: 'm1', role: 'user', content: 'Tell me about Free Ventures at Berkeley.' },
    {
      id: 'm2',
      role: 'assistant',
      content:
        'Free Ventures is a student-run pre-seed accelerator at Berkeley. Applications close September 11.',
    },
  ],
  insights: [],
  pinnedTier: null,
  archived: false,
};
const byId = (id: string) => (id === parent.id ? parent : undefined);

// 1. Compile a minimal brief from the assembled path above a fork.
//    `assemblePath` renders parent brief + merged insights + anchored transcript.
const path = assemblePath({ parent, byId });
const { brief } = await compileBrief(
  {
    briefId: 'brief-1',
    branchId: 'branch-1',
    pathMarkdown: path.markdown,
    selection: 'Free Ventures applications',
    question: 'When do applications close?',
    availableTokens: path.tokens,
    // The inherited brief's top fact — keeps the chain's grounding entity through deep
    // compositions. Undefined here (roots carry no brief); always pass it through.
    anchorFact: path.anchorFact,
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

### Live providers

`complete` goes live when exactly one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `XAI_API_KEY` is
set — the key selects the provider (`src/provider.ts`; Anthropic wins if more than one is set).
`BONSAI_MODEL_<PROVIDER>_<QUICK|MID|DEEP|CEILING>` overrides the upstream model id per rung
(e.g. `BONSAI_MODEL_ANTHROPIC_DEEP=claude-opus-5`) — model names rot faster than deploys, and the
fix should be an env var. Every live failure — dead key, wrong model id, rate limit, timeout —
logs one server-side warn and degrades to the extractive mock; nothing throws.

## Learning router

Feedback is real behavior, not an AI judge. On each user action, fold an event into the profile
with `recordFeedback` (immutable — returns a new profile): `override` (the user moved the pick),
`escalation` (the ladder upgraded a failed answer), `merge` (the branch's answer was kept),
`abandon` (discarded). Pass the profile into `route()`; on the auto path `adjustForProfile`
pre-empts the classifier once the evidence is sufficient and consistent.

`mergeProfiles` sums many users' profiles into one population prior. Pass it as `population` to
`route()` (or `adjustForProfile`) and a new user cold-starts on the community's routing memory;
their own history wins once it clears the evidence bar. Aggregate anonymized profiles server-side
— the merge itself is a pure fold.

```ts
import { emptyProfile, mergeProfiles, recordFeedback } from '@bonsai/engine';

let profile = emptyProfile();
// The user bumped a quick pick up to deep on a reasoning question.
profile = recordFeedback(profile, {
  kind: 'override',
  classifiedTier: 'quick',
  chosenTier: 'deep',
  questionKind: 'reasoning',
});

const population = mergeProfiles(allUserProfiles); // anonymized per-user profiles, folded server-side

const routing = await route(
  { question, brief, contextTokens: brief.briefTokens, profile, population },
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
