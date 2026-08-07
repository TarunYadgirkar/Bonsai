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
} from '@/lib/store';
import { messagesTokens } from '@/lib/tokens';
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

  appendMessage(conversation.id, {
    id: nextId('msg'),
    role: 'user',
    content: body.content,
    createdAt: new Date().toISOString(),
  });

  // A branch answers off its compiled brief plus its own turns; the root carries full history.
  const priorTurns = messagesTokens(conversation.messages);
  const contextTokens = conversation.brief
    ? conversation.brief.briefTokens + priorTurns
    : priorTurns + availableTokensFor(conversation.parentId);

  const context = conversation.brief
    ? `${conversation.brief.markdown}\n\n---\n## This branch so far\n${renderTurns(conversation.messages)}`
    : renderTurns(conversation.messages);

  const pinnedTier = body.pinnedTier ?? conversation.pinnedTier;
  const initial = await route({
    question: body.content,
    brief: conversation.brief,
    contextTokens,
    pinnedTier,
  });

  const result = await completeWithEscalation({
    routing: initial,
    systemPrompt: ANSWER_SYSTEM_PROMPT,
    userPrompt: `${context}\n\n---\n${body.content}`,
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
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      baselineInputTokens: conversation.brief
        ? conversation.brief.availableTokens + priorTurns
        : contextTokens,
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

function renderTurns(messages: { role: string; content: string }[]): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
}
