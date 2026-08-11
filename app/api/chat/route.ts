import { buildLog } from '@/lib/mock';
import { completeWithEscalation, route } from '@/lib/router';
import {
  appendMessage,
  availableTokensFor,
  flushLogs,
  getConversation,
  loadStore,
  logInference,
  nextId,
  saveStore,
  visibleContextFor,
} from '@/lib/store';
import { estimateTokens } from '@/lib/tokens';
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

  const context = visibleContextFor(conversation.id);
  if (!context) {
    return Response.json({ error: 'conversation context unavailable' } satisfies ApiError, {
      status: 500,
    });
  }

  const questionTokens = estimateTokens(body.content);
  const contextTokens = context.tokens + questionTokens;
  const baselineInputTokens = availableTokensFor(conversation.id) + questionTokens;
  const userMessage = {
    id: nextId('msg'),
    role: 'user' as const,
    content: body.content,
    createdAt: new Date().toISOString(),
  };
  appendMessage(conversation.id, userMessage);

  const pinnedTier = body.pinnedTier ?? conversation.pinnedTier;
  const initial = await route({
    question: body.content,
    brief: conversation.brief,
    contextTokens,
    pinnedTier,
    mode: body.mode,
  });

  const result = await completeWithEscalation({
    routing: initial,
    systemPrompt: ANSWER_SYSTEM_PROMPT,
    userPrompt: `${context.markdown}\n\n---\n${body.content}`,
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
      baselineInputTokens,
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
