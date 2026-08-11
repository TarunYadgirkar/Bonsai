# Truthful Context Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $subagent-driven-development (recommended) or $executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every branch, nested fork, chat turn, and merge use one exact, provenance-carrying context boundary.

**Architecture:** A pure assembler renders the visible state of one conversation as ordered sources. The compiler consumes that assembly and persists an immutable brief plus fact-level source IDs. Chat and merge routes use the same boundary, so merged insights affect future inference and nested branches inherit the parent brief rather than accidentally dropping their ancestors.

**Tech Stack:** Next.js 16.3 App Router, React 19.2, TypeScript 5 strict mode, Vitest, npm.

## Global Constraints

- Work only on copy-b.
- Keep complete() as the only inference entry point.
- Existing compiled briefs remain immutable.
- New brief facts must cite source IDs present in the compiler input.
- No external provider is needed for tests.
- Mock mode must remain fully usable.
- Run npm test, npm run lint, and npm run build before every implementation commit.
- Use short Conventional Commit subjects without trailers.

---

## File map

- package.json: test commands.
- package-lock.json: locked Vitest dependency graph.
- vitest.config.ts: Node test environment and path alias.
- lib/tokens.test.ts: passing characterization used to prove the harness.
- lib/types.ts: context provenance contracts.
- lib/context.ts: pure visible-context assembly and rendering.
- lib/context.test.ts: exact ordering, nested inheritance, insight inclusion, and immutability tests.
- lib/compiler.ts: provenance-aware compilation and deterministic fallback.
- lib/compiler.test.ts: compiler parsing and source-validation tests.
- lib/store.ts: store-backed context lookup and legacy fixture normalization.
- lib/store.test.ts: available-token and legacy normalization characterization.
- app/api/chat/route.ts: chat prompting through assembled context.
- app/api/branch/route.ts: branch compilation from assembled parent context.
- app/api/merge/route.ts: evidence IDs on merged insights.
- app/api/context-flow.test.ts: route-level root → branch → merge → nested branch acceptance test.
- components/ChatPane.tsx: no structural change; brief facts stay string[] in this milestone.
- scripts/try-engine.ts: print fact source IDs alongside facts.
- fixtures/seed-tree.json: regenerate through the existing script after contracts change.

### Task 1: Add the test harness

**Files:**
- Modify: package.json
- Modify: package-lock.json
- Create: vitest.config.ts
- Create: lib/tokens.test.ts

**Interfaces:**
- Produces: npm test and npm run test:watch.
- Produces: a clean, passing baseline before context-engine work starts.

- [ ] **Step 1: Install Vitest**

Run:

```bash
npm install --save-dev vitest
```

Expected: package.json and package-lock.json add Vitest; installation exits 0.

- [ ] **Step 2: Add scripts and configuration**

Add these package scripts:

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Create vitest.config.ts:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    restoreMocks: true,
  },
});
```

- [ ] **Step 3: Write a passing token characterization test**

Create lib/tokens.test.ts:

```ts
import { describe, expect, it } from 'vitest';
import { estimateTokens, prunedPct } from './tokens';

describe('token estimates', () => {
  it('rounds text tokens and pruning exactly as the UI expects', () => {
    expect(estimateTokens('12345')).toBe(2);
    expect(prunedPct(1_000, 250)).toBe(75);
  });
});
```

- [ ] **Step 4: Verify red**

Run:

```bash
npm test -- lib/context.test.ts
```

Expected: PASS with one test.

- [ ] **Step 5: Commit the harness only**

Run:

```bash
git add package.json package-lock.json vitest.config.ts lib/tokens.test.ts
git commit -m "test: add context engine harness"
git push origin copy-b
```

### Task 2: Implement visible-context assembly

**Files:**
- Modify: lib/types.ts
- Create: lib/context.ts
- Create: lib/context.test.ts
- Modify: lib/context.test.ts
- Modify: lib/store.ts
- Create: lib/store.test.ts

**Interfaces:**
- Produces: ContextSourceKind, ContextSourceRef, ContextSource, AssembledContext.
- Produces: assembleVisibleContext(conversationId, lookup): AssembledContext.
- Produces: visibleContextFor(conversationId): AssembledContext | undefined from lib/store.ts.

- [ ] **Step 1: Add failing nested and immutability tests**

Create lib/context.test.ts with a local conversation factory. First assert a root renders profile, messages, then active insights with source IDs profile:root, m1, and i1. Add tests that create root → parent branch where the parent has:

- brief id brief-parent containing the root facts;
- one parent message id parent-turn;
- one active insight id parent-insight;
- one inactive insight id revoked-insight.

Assert:

```ts
expect(result.sources.map((source) => source.sourceId)).toEqual([
  'brief-parent',
  'parent-turn',
  'parent-insight',
]);
expect(result.markdown).not.toContain('revoked');
expect(parent.brief?.markdown).toBe(originalBriefMarkdown);
```

Run npm test -- lib/context.test.ts and expect FAIL for missing contracts.

- [ ] **Step 2: Add the context contracts**

Add to lib/types.ts:

```ts
export type ContextSourceKind = 'profile' | 'brief' | 'message' | 'insight';

export interface ContextSourceRef {
  kind: ContextSourceKind;
  conversationId: string;
  sourceId: string;
}

export interface ContextSource extends ContextSourceRef {
  content: string;
}

export interface AssembledContext {
  markdown: string;
  sources: ContextSource[];
  tokens: number;
}
```

Extend ContextBrief without changing facts:

```ts
sourceRefs: ContextSourceRef[];
factSourceIds: string[][];
```

Extend Insight:

```ts
sourceMessageIds: string[];
active: boolean;
```

- [ ] **Step 3: Implement the pure assembler**

Create lib/context.ts. It must:

1. Load exactly the requested conversation through the injected lookup.
2. For a root, append profile, messages, then active insights.
3. For a branch, append the immutable brief, its own messages, then active insights.
4. Render every block with a [source:<kind>:<sourceId>] marker.
5. Compute tokens from the final markdown.
6. Throw an Error naming an unknown conversation ID.

Use this exported signature:

```ts
export type ConversationLookup = (id: string) => Conversation | undefined;

export function assembleVisibleContext(
  conversationId: string,
  lookup: ConversationLookup,
): AssembledContext;
```

Use this source construction rule:

```ts
const sources: ContextSource[] = conversation.parentId === null
  ? [
      ...(conversation.profile ? [profileSource(conversation)] : []),
      ...conversation.messages.map((message) => messageSource(conversation.id, message)),
      ...activeInsightSources(conversation),
    ]
  : [
      ...(conversation.brief ? [briefSource(conversation.id, conversation.brief)] : []),
      ...conversation.messages.map((message) => messageSource(conversation.id, message)),
      ...activeInsightSources(conversation),
    ];
```

- [ ] **Step 4: Add the store wrapper and legacy normalization**

In lib/store.ts add:

```ts
export function visibleContextFor(id: string): AssembledContext | undefined {
  if (!getConversation(id)) return undefined;
  return assembleVisibleContext(id, getConversation);
}
```

Normalize old fixture briefs to sourceRefs: [] and one empty factSourceIds entry per fact. Normalize old insights to sourceMessageIds: [] and active: true. Apply normalization only while building or loading a snapshot; never mutate imported JSON.

Add lib/store.test.ts asserting:

- a legacy string-fact brief loads with aligned empty factSourceIds;
- availableTokensFor includes active insight text;
- an inactive insight is excluded from available token accounting.

- [ ] **Step 5: Verify green**

Run:

```bash
npm test -- lib/context.test.ts lib/store.test.ts
npm run lint
npm run build
```

Expected: all tests pass; lint and build exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/context.ts lib/context.test.ts lib/store.ts lib/store.test.ts
git commit -m "feat: assemble visible branch context"
git push origin copy-b
```

### Task 3: Compile immutable briefs with fact provenance

**Files:**
- Modify: lib/compiler.ts
- Create: lib/compiler.test.ts
- Modify: lib/llm.ts only if a test seam is required.
- Modify: lib/mock.ts

**Interfaces:**
- Consumes: AssembledContext and ContextSourceRef.
- Changes: CompileParams replaces parentMessages/profile with parentContext.
- Produces: ContextBrief.sourceRefs and ContextBrief.factSourceIds aligned by fact index.

- [ ] **Step 1: Write compiler parsing tests**

Mock complete() to return:

```json
{
  "facts": [
    {
      "text": "Codex App Server is the selected runtime.",
      "sourceIds": ["i1", "unknown-source"]
    }
  ],
  "excludedNote": "Excluded unrelated UI discussion."
}
```

Pass a parentContext containing source i1 and assert:

```ts
expect(brief.facts).toEqual(['Codex App Server is the selected runtime.']);
expect(brief.factSourceIds).toEqual([['i1']]);
expect(brief.sourceRefs).toEqual(parentContext.sources.map(({ content: _content, ...ref }) => ref));
```

Add a second test where complete() returns invalid JSON. Assert the fallback fact cites only valid candidate source IDs and the excludedNote contains compiler fallback.

Run npm test -- lib/compiler.test.ts and expect FAIL.

- [ ] **Step 2: Change CompileParams and compiler output**

Use:

```ts
export interface CompileParams {
  briefId: string;
  branchId: string;
  parentContext: AssembledContext;
  selection: string;
  question: string;
  availableTokens: number;
}

interface CompilerFact {
  text: string;
  sourceIds: string[];
}

interface CompilerOutput {
  facts: CompilerFact[];
  excludedNote: string;
}
```

The system prompt must require JSON facts with text and sourceIds, state that every source ID must come from the supplied [source:...] markers, and cap output at eight facts.

- [ ] **Step 3: Validate provenance**

After parsing:

1. Reject non-string fact text.
2. Keep only string source IDs present in parentContext.sources.
3. Deduplicate source IDs without reordering.
4. Drop empty fact text.
5. Preserve at most eight facts.
6. Store sourceRefs by removing content from parentContext.sources.

Render facts using fact.text while preserving the existing markdown surface.

- [ ] **Step 4: Make the fallback deterministic**

The fallback must rank parentContext.sources by keyword overlap with selection plus question, take at most three non-empty sources, turn their first complete sentence into facts, and attach each selected source's ID. If no source overlaps, return one selection fact with no source IDs and explicitly label the degraded fallback.

Update mock compiler output to the structured fact shape so zero-key mode exercises the same parser.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- lib/compiler.test.ts lib/context.test.ts lib/store.test.ts
npm run lint
npm run build
```

Expected: all checks pass.

Commit:

```bash
git add lib/compiler.ts lib/compiler.test.ts lib/mock.ts
git commit -m "feat: preserve brief provenance"
git push origin copy-b
```

### Task 4: Route branch and chat inference through the context boundary

**Files:**
- Modify: app/api/branch/route.ts
- Modify: app/api/chat/route.ts
- Modify: app/api/merge/route.ts
- Create: app/api/context-flow.test.ts

**Interfaces:**
- Consumes: visibleContextFor().
- Produces: nested branches compiled from the parent's visible context.
- Produces: merged Insight.sourceMessageIds and active.

- [ ] **Step 1: Write the failing acceptance test**

The test must:

1. Insert a small root with one relevant and one unrelated message.
2. Insert a child with a stored brief and one assistant conclusion.
3. Merge the child into the root through POST /api/merge.
4. Create a new parent branch, then a nested branch through POST /api/branch.
5. Assert the parent brief factSourceIds cites the merged active insight.
6. Assert the nested brief sourceRefs includes the immutable parent brief and its markdown contains the insight text through that brief.
7. Assert it excludes the unrelated root message because that text is not in the parent's visible context.
8. Send POST /api/chat to the root and assert the completion prompt includes the merged insight.

Mock complete() with purpose-aware structured outputs; mock appendInferenceLogs so tests do not write data/inference-log.json.

Run npm test -- app/api/context-flow.test.ts and expect FAIL.

- [ ] **Step 2: Fix branch creation**

In app/api/branch/route.ts:

- resolve parentContext = visibleContextFor(parent.id);
- return a 500 ApiError if the parent exists but assembly fails;
- pass parentContext to compileBrief;
- keep availableTokensFor(parent.id) plus selection tokens as the full-history baseline;
- never pass parent.messages or profileFor();
- remove profileFor() when it becomes unused.

The branch's first answer must use the new brief markdown, while later turns go through chat's visible context.

- [ ] **Step 3: Fix chat prompting**

In app/api/chat/route.ts:

1. Assemble context before appending the current user message.
2. Append the user message exactly once.
3. Route with context.tokens plus the current question tokens.
4. Send context.markdown, one separator, then the question.
5. Compute baseline from full ancestral messages, active insights, existing branch turns, and the current question.
6. Do not manually concatenate brief.markdown or renderTurns().

Delete renderTurns() when unused.

- [ ] **Step 4: Add merge evidence**

When creating Insight in app/api/merge/route.ts add:

```ts
sourceMessageIds: branch.messages.map((message) => message.id),
active: true,
```

The distiller continues to read only the branch's visible state. Use visibleContextFor(branch.id).markdown instead of manually joining branch.messages so a merge can distill conclusions that depend on the branch's inherited brief.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all tests and build pass.

Commit:

```bash
git add app/api/branch/route.ts app/api/chat/route.ts app/api/merge/route.ts app/api/context-flow.test.ts
git commit -m "fix: honor tree context semantics"
git push origin copy-b
```

### Task 5: Regenerate the demo and close the milestone

**Files:**
- Modify: scripts/try-engine.ts
- Modify: fixtures/seed-tree.json
- Modify: docs/BUILD_LOG.md

**Interfaces:**
- Consumes: ContextBrief.factSourceIds.
- Produces: a generated fixture compatible with the new contract.
- Produces: recorded verification evidence for later sessions.

- [ ] **Step 1: Update the engine script**

Print each fact with its aligned source IDs:

```ts
for (const [index, fact] of brief.facts.entries()) {
  const sourceIds = brief.factSourceIds[index] ?? [];
  console.log('  - ' + fact + ' [' + sourceIds.join(', ') + ']');
}
```

- [ ] **Step 2: Regenerate the fixture through the supported path**

Start the mock development server on port 3111 with DATABASE_URL empty, then run:

```bash
npx tsx scripts/build-seed-tree.ts
```

Expected: fixtures/seed-tree.json changes only through the generator and every new brief contains sourceRefs and factSourceIds.

- [ ] **Step 3: Run the full gate**

```bash
npm test
npm run lint
npm run build
```

Then run the context-flow acceptance test by name and confirm it passes independently.

- [ ] **Step 4: Update the durable log**

Append:

- commit IDs for Tasks 1-4;
- exact verification commands and pass counts;
- fixture regeneration evidence;
- remaining risks;
- next plan: local persistence.

- [ ] **Step 5: Review and commit**

Use code-reviewer, typescript-reviewer, and react-reviewer only if React changed. Fix every concrete finding, rerun the gate, then:

```bash
git add scripts/try-engine.ts fixtures/seed-tree.json docs/BUILD_LOG.md
git commit -m "test: verify truthful context flow"
git push origin copy-b
```

## Milestone completion gate

The milestone is complete only when:

- nested forks compile from the parent brief plus its turns and active insights;
- merged insights appear in future chat prompts;
- every new compiled fact has aligned, validated source IDs;
- old briefs remain immutable;
- full test, lint, and production build gates pass;
- copy-b is pushed and the build log contains exact evidence.
