# Truthful Core Review Fixes Report

Date: 2026-08-11

## Outcome

All requested truthful-core review items were implemented in `copy-b` without adding local file
persistence. The core implementation is commit `d4a5063fd8279a9e27c98aea8ad866d6ee61d545`
(`fix: harden truthful inference`). The regenerated fixture, fixture contract, build log, and this
report are in the follow-up `test: regenerate truthful fixture` commit that contains this file.

## Requirement evidence

1. The zero-key mock no longer contains Berkeley deadline/ranking answer tables. It ranks only
   supplied evidence and returns a grounded decline when evidence is absent. Negative deadline and
   ranking tests cover unrelated sources.
2. Deterministic compilation retains short sources such as `Use SQLite.` with the original source
   ID. Nested brief compilation extracts only its fact section and excludes question/request text.
3. A blank merge completion logs its exact usage as failed, returns 502, and changes neither parent
   insights nor branch archive state.
4. Branch, chat, merge, and conversation POST bodies are parsed and validated before store access,
   IDs, inference, or mutation. Tests cover content type, malformed/non-object JSON, 64 KiB payload
   limit, blank/oversized strings, IDs, tiers, models, efforts, modes, and archive type.
5. Chat user/assistant turns are committed together only after routing and completion succeed.
   Branch conversation/tree state is committed only after requested inference succeeds. Completed
   compiler/classifier/retry events are still logged on later provider rejection.
6. KV hydration validates the complete runtime snapshot before replacing memory, including nested
   fact-source arrays, provenance, insight lifecycle, source membership, tree structure, and
   sequence monotonicity. Malformed valid JSON retains prior memory.
7. Compiler, classifier, and every answer attempt preserve one exact `CompleteResult`. Each actual
   completion produces one `InferenceLog` with requested model/effort, optional upstream
   `servedBy`, exact provider usage when reported, modeled catalog cost, and accepted/failed status.
8. Bonsai totals count compiler, classifier, merge, and retry overhead. Only the final delivered
   answer receives one modeled ceiling-model full-history baseline; every other event receives
   exact zero baseline. Economics UI/contracts call costs modeled catalog equivalents, including
   the placeholder ceiling rate, rather than provider invoices or published spend.
9. Initial branch routing includes the question tokens. Its delivered-answer baseline includes
   full parent history plus the question exactly once, and manual override state persists in both
   routing and the answer log.
10. `npm run fixture:serve` is the supported non-production root-only startup;
    `npm run fixture:build` regenerates through it. Root-only mode forces in-memory storage even if
    KV configuration survives in the environment, and production ignores the flag.
11. Each fact persists `model-cited`, `extractive`, or conservative `legacy-unknown` provenance.
    Contracts and UI say source-ID membership is traceability, not semantic entailment. Unknown or
    fabricated source IDs are rejected. Exact evidence excerpts were not added; this remains an
    explicit future enhancement rather than an overstated guarantee.
12. A configured provider failure raises a typed unavailable error and returns a safe 502 at API
    boundaries. Mock is selected only when no provider key is configured. HTTP-200 blank provider
    output retains usage metadata for merge failure logging or chat retry handling.

## TDD and review evidence

- Initial RED checks exposed five expected regressions around canned answers, short-source loss,
  silent provider fallback, and blank merge success.
- Reviewer-focused RED checks produced 6 failures across 25 tests for nested question leakage,
  blank provider metadata, invented legacy provenance, cyclic/stale KV state, and selection
  double-counting.
- A final KV source-membership RED check produced 1 failure across 12 tests before the validator
  rejected unknown fact source IDs.
- The completed suite is 12 files and 71 passing tests.
- The read-only reviewer found and the implementation resolved: strict-TS provenance widening,
  nested-brief question leakage, KV cycles/stale sequence, live blank-usage loss, missing `tsx`,
  provider-cost overlabeling, placeholder-baseline overlabeling, stale fixture provenance, and
  invented legacy provenance.

## Fixture evidence

Commands:

```text
npm run fixture:serve
npm run fixture:build
```

The generator completed without hand-editing or temporary fixture replacement and wrote 6
branches, 18 logs, and sequence 44. The fixture contains 33 facts and 380 source references. All
new facts are `extractive`; fact/source arrays align; every named source ID is present in its brief;
persisted IDs are unique; query-like source text is absent from facts. Log purposes are 6 compile,
5 classify, and 7 chat. The 7 delivered answers are the only nonzero counterfactual baselines.

## Verification

- `npm test` — 12 files, 71 tests passed.
- `npx tsc --noEmit` — passed under strict TypeScript.
- `npm run lint` — passed.
- `npx next build --webpack` — passed, including TypeScript and 8/8 static-page generation steps.
- `npm run build` — Turbopack-only sandbox exception: its CSS worker cannot bind a local port
  (`Operation not permitted (os error 1)`). This is the documented environment failure, not a code
  failure.
- `DATABASE_URL= ANTHROPIC_API_KEY= OPENAI_API_KEY= XAI_API_KEY= npx tsx scripts/try-engine.ts`
  — selected mock provider and passed both routing/grounding cases with extractive source IDs.
- `fixtures/seed-tree.test.ts` — 3 fixture citation/ID/provenance/accounting/override checks passed.
- `git diff --check` — passed.
- Tracked-file secret-pattern scan — no matches.
- Dependency audit during `npm install --save-dev tsx` — 0 vulnerabilities.

## Remaining concerns

- `model-cited` proves only that the model named a supplied source ID. It does not prove that the
  fact is supported or entailed by the source.
- The no-key compiler is an extractive relevance heuristic. A nested branch correctly declines if
  its immutable parent brief did not retain the required detail.
- Local file persistence is intentionally out of scope and remains unimplemented.
- The hosted API is still unauthenticated and uses a shared global snapshot.
- Default Turbopack builds need an environment that permits its internal worker port; webpack is
  the green production-build gate in this sandbox.
