import { NodeActionRequestSchema, apiError, apiRoute, persistenceError } from '@/lib/api';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveSession, withSession } from '@/lib/session';
import { buildTree, commit, getConversation, loadWorkingSet, updateConversation } from '@/lib/store';
import type { NodeActionResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Rename a node, or archive/unarchive a branch without going through merge. */
export const POST = apiRoute(NodeActionRequestSchema, async (body, request) => {
  const session = resolveSession(request);
  const limit = checkRateLimit(session.id, 'mutation');
  if (!limit.ok) return apiError(`rate limit exceeded — retry in ${limit.retryAfterSeconds}s`, 429);
  const ws = await loadWorkingSet(session.id);
  const conversation = getConversation(ws, body.id);
  if (!conversation) return apiError(`unknown node ${body.id}`, 404);

  if (body.op === 'rename') {
    updateConversation(ws, body.id, (c) => ({ ...c, title: body.title!.trim() }));
  } else if (body.op === 'archive') {
    // Roots anchor their whole tree in the sidebar; archiving one would orphan the view.
    if (!conversation.parentId) return apiError('root conversations cannot be archived', 409);
    updateConversation(ws, body.id, (c) => ({ ...c, archived: true }));
  } else {
    updateConversation(ws, body.id, (c) => ({ ...c, archived: false }));
  }

  if ((await commit(ws)) === 'failed') return persistenceError();

  const updated = getConversation(ws, body.id)!;
  const node = buildTree(ws).find((n) => n.id === body.id);
  if (!node) return apiError('node missing after write', 500);
  const response: NodeActionResponse = { node, conversation: updated };
  return withSession(Response.json(response), session);
});
