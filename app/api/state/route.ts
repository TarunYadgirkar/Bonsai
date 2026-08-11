import { apiRoute } from '@/lib/api';
import { buildTree, listConversations, loadWorkingSet } from '@/lib/store';
import type { StateResponse } from '@/lib/types';

/** Store is mutable; prerendering this at build time would freeze the seed state. */
export const dynamic = 'force-dynamic';

export const GET = apiRoute(null, async () => {
  const ws = await loadWorkingSet();
  const body: StateResponse = {
    rootId: ws.rootId,
    tree: buildTree(ws),
    conversations: listConversations(ws),
  };
  return Response.json(body);
});
