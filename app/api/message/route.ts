import { truncateForRerun } from '@bonsai/engine';
import { MessageActionRequestSchema, apiError, apiRoute } from '@/lib/api';
import { runChatTurn } from '@/lib/chat-turn';
import { resolveSession, withSession } from '@/lib/session';
import { getConversation, loadWorkingSet, truncateMessages } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Regenerate an answer, or edit a user turn and rerun it. Both cut the thread back to just
 * before the relevant user turn (the store queues real row deletes) and then replay it through
 * the shared chat path — routing, escalation, accounting, and learning all behave exactly as if
 * the turn had been typed fresh. Spend on the discarded answers stays in the ledger: the money
 * was spent.
 */
export const POST = apiRoute(MessageActionRequestSchema, async (body, request) => {
  const session = resolveSession(request);
  const ws = await loadWorkingSet(session.id);
  const conversation = getConversation(ws, body.branchId);
  if (!conversation) return apiError(`unknown branch ${body.branchId}`, 404);
  if (conversation.archived) return apiError('branch is archived — unarchive it first', 409);

  const plan = truncateForRerun(conversation, body.messageId, body.op);
  if (!plan) return apiError('message not found or not rerunnable', 404);

  truncateMessages(ws, conversation.id, plan.keep);
  const content = body.op === 'edit' ? body.content!.trim() : plan.userContent;

  const turn = await runChatTurn({
    ws,
    sessionId: session.id,
    branchId: conversation.id,
    content,
    pinnedTier: body.pinnedTier,
    mode: body.mode,
  });
  if (!turn.ok) return apiError(turn.error, turn.status);
  return withSession(Response.json(turn.response), session);
});
