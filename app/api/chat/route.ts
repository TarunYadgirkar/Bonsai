import {
  completeWithEscalation,
  renderChatContext,
  route,
  widenedChatContext,
} from '@bonsai/engine';
import { buildLog } from '@/lib/accounting';
import {
  appendMessage,
  availableTokensFor,
  flushLogs,
  getConversation,
  loadStore,
  logInference,
  nextId,
  saveStore,
  updateConversation,
} from '@/lib/store';
import type { ApiError, ChatRequest, ChatResponse } from '@/lib/types';

const ANSWER_SYSTEM_PROMPT =
  'You answer using only the context provided. If it is a compiled brief, it is deliberately minimal and self-contained; if it genuinely lacks what you need, say so plainly rather than guessing.';

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<ChatRequest>;
  if (!body.branchId || !body.content) {
    return Response.json({ error: 'branchId and content are required' } satisfies ApiError, {
      status: 400,
    });
  }

  await loadStore();
  const conversation = getConversation(body.branchId);
  if (!conversation) {
    return Response.json({ error: `unknown branch ${body.branchId}` } satisfies ApiError, {
      status: 404,
    });
  }

  // A manual pick pins the branch; an explicit switch back to auto unpins it. Pin-per-branch
  // (not per message) also keeps the provider prompt cache warm across the branch.
  if (body.mode?.mode === 'manual') {
    updateConversation(conversation.id, (c) => ({ ...c, pinnedMode: body.mode }));
  } else if (body.mode?.mode === 'auto') {
    updateConversation(conversation.id, (c) => ({ ...c, pinnedMode: null }));
  }

  appendMessage(conversation.id, {
    id: nextId('msg'),
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
      const wider = widenedChatContext(conversation, getConversation);
      return wider
        ? { userPrompt: `${wider.context}\n\n---\n${body.content}`, addedTokens: wider.addedTokens }
        : null;
    },
  });

  const message = {
    id: nextId('msg'),
    role: 'assistant' as const,
    content: result.text,
    routing: result.routing,
    createdAt: new Date().toISOString(),
  };
  appendMessage(conversation.id, message);

  const log = logInference(
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
        : contextTokens + availableTokensFor(conversation.parentId),
      escalated: result.routing.escalated,
      overridden: result.routing.overridden,
    }),
  );

  await saveStore();
  await flushLogs();

  const response: ChatResponse = {
    branchId: conversation.id,
    message,
    routing: result.routing,
    log,
  };
  return Response.json(response);
}
