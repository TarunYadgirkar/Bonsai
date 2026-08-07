import { buildLog, mockMessage, mockRoute } from '@/lib/mock';
import { appendMessage, availableTokensFor, getConversation, logInference, nextId } from '@/lib/store';
import { estimateTokens } from '@/lib/tokens';
import type { ApiError, ChatRequest, ChatResponse } from '@/lib/types';

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<ChatRequest>;
  if (!body.branchId || !body.content) {
    return Response.json({ error: 'branchId and content are required' } satisfies ApiError, {
      status: 400,
    });
  }

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

  // A branch answers off its compiled brief; the root has no brief and carries its own history.
  const contextTokens = conversation.brief
    ? conversation.brief.briefTokens
    : availableTokensFor(conversation.parentId) + estimateTokens(body.content);

  const pinnedTier = body.pinnedTier ?? conversation.pinnedTier;
  const routing = mockRoute(body.content, contextTokens, pinnedTier);
  const message = mockMessage(routing.tier, body.content, routing);
  appendMessage(conversation.id, message);

  const log = logInference(
    buildLog({
      branchId: conversation.id,
      purpose: 'chat',
      tier: routing.tier,
      inputTokens: contextTokens,
      outputTokens: estimateTokens(message.content),
      baselineInputTokens: conversation.brief
        ? conversation.brief.availableTokens
        : contextTokens,
    }),
  );

  const response: ChatResponse = { branchId: conversation.id, message, routing, log };
  return Response.json(response);
}
