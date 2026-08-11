# Durability final fix report

Date: 2026-08-11
Lane: `copy-b`
Base: `66c60b50187566bd1599301146e4cc156b42b9c7`
Commit: final `copy-b` HEAD at handoff (`fix: preserve failed branch routing`)

## Fix

- Passed the completed branch routing decision into failed-inference logging.
- Persisted the completed failed manual answer with `status: failed`, `escalated: true`, and `overridden: true` when its sanity-check escalation provider rejects.
- Preserved the existing log-only transaction: compiler and failed answer events commit atomically while the staged branch remains unpublished.
- Added a route-level regression through the real request and memory-persistence seams.
- Appended a narrow correction to `docs/BUILD_LOG.md` because its Task 5 provider-failure accounting claim otherwise overstated the exact routing metadata preserved.

## RED → GREEN

- RED: the route-level test observed one compiler-plus-answer commit and no new conversation, but the failed answer contained `escalated: false` and `overridden: false`.
- GREEN: the same persisted event contains `status: failed`, `escalated: true`, and `overridden: true`; the compiler and failed answer remain in one commit and no branch is published.

## Verification

- Focused branch/context/inference/persistence suite: 12 files, 152 tests passed.
- Full Vitest: 21 files, 255 tests passed.
- Strict TypeScript: `npx tsc --noEmit --strict` passed.
- ESLint: `npm run lint -- --max-warnings=0` passed.
- Webpack production build: `npx next build --webpack` passed; 8/8 static pages generated.
- Fixture contract: root-only memory fixture regenerated successfully with 6 branches, 18 logs, sequence 44, no fixture diff; 5 contract tests passed.
- `git diff --check`, changed-file high-confidence secret scan, and added-line debug scan passed.

## Reviews

- Code reviewer: no Critical, Important, or Minor findings; READY.
- TypeScript reviewer: no findings; APPROVE.
- No security reviewer was dispatched because the change adds no request input, authentication, authorization, provider, error, secret, or execution surface; it only forwards an existing typed routing decision into an existing persisted log builder.

## Concerns

- None remaining in scope.
