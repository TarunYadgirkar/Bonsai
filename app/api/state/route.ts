import { apiRoute } from '@/lib/api';
import { resolveSession, withSession } from '@/lib/session';
import { buildTree, listConversations, loadWorkingSet } from '@/lib/store';
import type { StateResponse } from '@/lib/types';

/** Store is mutable; prerendering this at build time would freeze the seed state. */
export const dynamic = 'force-dynamic';

export const GET = apiRoute(null, async (_body, request) => {
  const session = resolveSession(request);
  const ws = await loadWorkingSet(session.id);
  const body: StateResponse = {
    rootId: ws.rootId,
    tree: buildTree(ws),
    conversations: listConversations(ws),
  };
  return withSession(Response.json(body), session);
});
