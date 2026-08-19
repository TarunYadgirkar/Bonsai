import { truncateForRerun } from '@bonsai/engine';
import { MessageActionRequestSchema } from '@/lib/api';
import { runChatTurn } from '@/lib/chat-turn';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveSession } from '@/lib/session';
import { sseTurnResponse } from '@/lib/sse-turn';
import { getConversation, loadWorkingSet, truncateMessages } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Streaming twin of POST /api/message — same contract in, the chat SSE protocol out. */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const parsed = MessageActionRequestSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return Response.json(
      { error: issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'invalid body' },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const session = resolveSession(request);
  const limit = checkRateLimit(session.id, 'inference');
  if (!limit.ok) {
    return Response.json(
      { error: `rate limit exceeded — retry in ${limit.retryAfterSeconds}s` },
      { status: 429 },
    );
  }
  const ws = await loadWorkingSet(session.id);
  const conversation = getConversation(ws, body.branchId);
  if (!conversation) {
    return Response.json({ error: `unknown branch ${body.branchId}` }, { status: 404 });
  }
  if (conversation.archived) {
    return Response.json({ error: 'branch is archived — unarchive it first' }, { status: 409 });
  }
  const plan = truncateForRerun(conversation, body.messageId, body.op);
  if (!plan) {
    return Response.json({ error: 'message not found or not rerunnable' }, { status: 404 });
  }

  truncateMessages(ws, conversation.id, plan.keep);
  const content = body.op === 'edit' ? body.content!.trim() : plan.userContent;

  return sseTurnResponse(session, (taps) =>
    runChatTurn({
      ws,
      sessionId: session.id,
      branchId: conversation.id,
      content,
      pinnedTier: body.pinnedTier,
      mode: body.mode,
      onDelta: taps.onDelta,
      onRestart: taps.onRestart,
      signal: request.signal,
    }),
  );
}
