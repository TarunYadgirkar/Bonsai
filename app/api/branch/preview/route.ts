import {
  INTERNAL_TIER,
  assemblePath,
  compileBrief,
  estimateTokens,
  profileFor,
} from 'bonsai-engine';
import { buildLog } from '@/lib/accounting';
import { BranchPreviewRequestSchema, apiError, apiRoute } from '@/lib/api';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveSession, withSession } from '@/lib/session';
import {
  availableTokensFor,
  commit,
  getConversation,
  loadWorkingSet,
  logInference,
  newId,
} from '@/lib/store';
import type { BranchPreviewResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Compile the brief WITHOUT creating the branch — the preview the fact-chip sheet edits before
 * the fork ships. The compile call costs what it costs (mock or Haiku), so it is logged like
 * any other inference, attributed to the parent since no branch exists yet.
 */
export const POST = apiRoute(BranchPreviewRequestSchema, async (body, request) => {
  const session = resolveSession(request);
  const limit = checkRateLimit(session.id, 'inference');
  if (!limit.ok) return apiError(`rate limit exceeded — retry in ${limit.retryAfterSeconds}s`, 429);
  const ws = await loadWorkingSet(session.id);
  const parent = getConversation(ws, body.parentId);
  if (!parent) return apiError(`unknown parent ${body.parentId}`, 404);

  const byId = (id: string) => getConversation(ws, id);
  const availableTokens =
    availableTokensFor(ws, parent.id, body.anchorMessageId) + estimateTokens(body.selection);
  const path = assemblePath({ parent, byId, anchorMessageId: body.anchorMessageId });
  const compiled = await compileBrief({
    briefId: newId('brief'),
    branchId: 'preview',
    pathMarkdown: path.markdown,
    profile: profileFor(parent, byId),
    selection: body.selection,
    question: body.question ?? '',
    availableTokens,
    anchorMessageId: body.anchorMessageId,
    anchorFact: path.anchorFact,
  });

  logInference(
    ws,
    buildLog({
      branchId: parent.id,
      purpose: 'compile',
      tier: INTERNAL_TIER,
      model: compiled.usage.model,
      inputTokens: compiled.usage.inputTokens,
      outputTokens: compiled.usage.outputTokens,
      baselineInputTokens: availableTokens,
      measured: !compiled.usage.mock,
    }),
  );
  await commit(ws); // best-effort: a failed log write must not block a preview

  const response: BranchPreviewResponse = {
    brief: compiled.brief,
    anchorFact: path.anchorFact ?? null,
  };
  return withSession(Response.json(response), session);
});
