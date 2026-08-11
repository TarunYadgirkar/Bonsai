import { NewConversationRequestSchema, apiError, apiRoute, persistenceError } from '@/lib/api';
import { resolveSession, withSession } from '@/lib/session';
import {
  buildTree,
  commit,
  getConversation,
  loadWorkingSet,
  newId,
  putConversation,
} from '@/lib/store';
import type { Conversation, NewConversationResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Start a fresh root conversation — a second tree, not a branch of the first.
 *
 * It carries the seeded profile so anything branched off it still compiles a brief that knows
 * who the user is; `parentId` is null, so it inherits no transcript and no tokens.
 */
export const POST = apiRoute(NewConversationRequestSchema, async (body, request) => {
  const session = resolveSession(request);
  const ws = await loadWorkingSet(session.id);
  const id = newId('conv');
  const seedProfile = getConversation(ws, ws.rootId)?.profile;

  const conversation: Conversation = {
    id,
    title: body.title?.trim() || 'New chat',
    parentId: null,
    ...(seedProfile ? { profile: seedProfile } : {}),
    messages: [],
    insights: [],
    pinnedTier: null,
    pinnedMode: null,
    archived: false,
  };
  putConversation(ws, conversation);

  const node = buildTree(ws).find((n) => n.id === id);
  if (!node) return apiError('conversation missing after write', 500);

  if ((await commit(ws)) === 'failed') return persistenceError();

  const response: NewConversationResponse = { node, conversation };
  return withSession(Response.json(response), session);
});
