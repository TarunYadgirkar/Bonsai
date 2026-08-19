import { ChatRequestSchema, apiError, apiRoute } from '@/lib/api';
import { runChatTurn } from '@/lib/chat-turn';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveSession, withSession } from '@/lib/session';
import { loadWorkingSet } from '@/lib/store';

export const POST = apiRoute(ChatRequestSchema, async (body, request) => {
  const session = resolveSession(request);
  const limit = checkRateLimit(session.id, 'inference');
  if (!limit.ok) return apiError(`rate limit exceeded — retry in ${limit.retryAfterSeconds}s`, 429);
  const ws = await loadWorkingSet(session.id);
  const turn = await runChatTurn({
    ws,
    sessionId: session.id,
    branchId: body.branchId,
    content: body.content,
    pinnedTier: body.pinnedTier,
    mode: body.mode,
  });
  if (!turn.ok) return apiError(turn.error, turn.status);
  return withSession(Response.json(turn.response), session);
});
