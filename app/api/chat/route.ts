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
  loadWorkingSet,
  logInference,
  newId,
  updateConversation,
} from '@/lib/store';
import type { ChatResponse } from '@/lib/types';

const ANSWER_SYSTEM_PROMPT =
  'You answer using only the context provided. If it is a compiled brief, it is deliberately minimal and self-contained; if it genuinely lacks what you need, say so plainly rather than guessing.';

export const POST = apiRoute(ChatRequestSchema, async (body) => {
  const ws = await loadWorkingSet();
  const conversation = getConversation(ws, body.branchId);
  if (!conversation) return apiError(`unknown branch ${body.branchId}`, 404);

  // A manual pick pins the branch; an explicit switch back to auto unpins it. Pin-per-branch
  // (not per message) also keeps the provider prompt cache warm across the branch.
  if (body.mode?.mode === 'manual') {
    updateConversation(ws, conversation.id, (c) => ({ ...c, pinnedMode: body.mode }));
  } else if (body.mode?.mode === 'auto') {
    updateConversation(ws, conversation.id, (c) => ({ ...c, pinnedMode: null }));
  }

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

  const response: ChatResponse = {
    branchId: conversation.id,
    message,
    routing: result.routing,
    log,
  };
  return Response.json(response);
});
