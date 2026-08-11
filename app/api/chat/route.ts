import {
  completeWithEscalation,
  renderChatContext,
  route,
  widenedChatContext,
} from '@bonsai/engine';
import { buildLog } from '@/lib/accounting';
import { ChatRequestSchema, apiError, apiRoute, persistenceError } from '@/lib/api';
import {
  appendMessage,
  availableTokensFor,
  commit,
  getConversation,
  loadProfile,
  loadWorkingSet,
  logInference,
  newId,
  recordRoutingFeedback,
  updateConversation,
} from '@/lib/store';
import type { ChatResponse, Conversation, Tier } from '@/lib/types';

/** Most recent tier the auto-router chose on this branch (ignoring manual/pinned picks). */
function lastAutoTier(conversation: Conversation): Tier | null {
  for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
    const r = conversation.messages[i].routing;
    if (r && !r.overridden) return r.tier;
  }
  return null;
}

const ANSWER_SYSTEM_PROMPT =
  'You answer using only the context provided. If it is a compiled brief, it is deliberately minimal and self-contained; if it genuinely lacks what you need, say so plainly rather than guessing.';

export const POST = apiRoute(ChatRequestSchema, async (body) => {
  const ws = await loadWorkingSet();
  let conversation = getConversation(ws, body.branchId);
  if (!conversation) return apiError(`unknown branch ${body.branchId}`, 404);

  // A manual pick pins the branch; an explicit switch back to auto unpins it — and both take
  // effect THIS turn, so `conversation` is rebound to the updated node before routing reads its
  // pin. Pin-per-branch (not per message) also keeps the provider prompt cache warm.
  if (body.mode?.mode === 'manual') {
    conversation =
      updateConversation(ws, conversation.id, (c) => ({ ...c, pinnedMode: body.mode })) ??
      conversation;
  } else if (body.mode?.mode === 'auto') {
    conversation =
      updateConversation(ws, conversation.id, (c) => ({ ...c, pinnedMode: null })) ?? conversation;
  }

  // The auto tier this branch last landed on, captured before the new turn is appended — the
  // baseline a manual pick this turn is judged an up/down override against.
  const priorAutoTier = lastAutoTier(conversation);

  appendMessage(ws, conversation.id, {
    id: newId('msg'),
    role: 'user',
    content: body.content,
    createdAt: new Date().toISOString(),
  });

  // Context = brief + merged insights + own turns (root: transcript + insights). The question
  // rides after the divider, so `conversation` staying pre-append is deliberate.
  const { context, contextTokens } = renderChatContext(conversation);

  const pinnedTier = body.pinnedTier ?? conversation.pinnedTier;
  const initial = await route({
    question: body.content,
    brief: conversation.brief,
    contextTokens,
    pinnedTier,
    mode: body.mode,
    pinnedMode: conversation.pinnedMode,
    profile: await loadProfile(),
  });

  const result = await completeWithEscalation({
    routing: initial,
    systemPrompt: ANSWER_SYSTEM_PROMPT,
    userPrompt: `${context}\n\n---\n${body.content}`,
    widen: () => {
      const wider = widenedChatContext(conversation, (id) => getConversation(ws, id));
      return wider
        ? { userPrompt: `${wider.context}\n\n---\n${body.content}`, addedTokens: wider.addedTokens }
        : null;
    },
  });

  const message = {
    id: newId('msg'),
    role: 'assistant' as const,
    content: result.text,
    routing: result.routing,
    createdAt: new Date().toISOString(),
  };
  appendMessage(ws, conversation.id, message);

  const log = logInference(
    ws,
    buildLog({
      branchId: conversation.id,
      purpose: 'chat',
      tier: result.routing.tier,
      model: result.routing.model,
      effort: result.routing.effort,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      baselineInputTokens: conversation.brief
        ? conversation.brief.availableTokens + contextTokens
        : contextTokens + availableTokensFor(ws, conversation.parentId),
      escalated: result.routing.escalated,
      overridden: result.routing.overridden,
    }),
  );

  if ((await commit(ws)) === 'failed') return persistenceError();

  // Learn from what just happened. An escalation means the classifier started too low; a manual
  // pick that moved off the branch's last auto tier is a labeled up/down correction. Both feed
  // the profile that shifts future routing — the "it learns from what you kept" loop.
  if (result.routing.escalated) {
    await recordRoutingFeedback({ kind: 'escalation', classifiedTier: initial.tier });
  }
  if (result.routing.overridden && priorAutoTier && priorAutoTier !== result.routing.tier) {
    await recordRoutingFeedback({
      kind: 'override',
      classifiedTier: priorAutoTier,
      chosenTier: result.routing.tier,
    });
  }

  const response: ChatResponse = {
    branchId: conversation.id,
    message,
    routing: result.routing,
    log,
  };
  return Response.json(response);
});
