import { buildTree, listConversations, rootId } from '@/lib/store';
import type { StateResponse } from '@/lib/types';

/** Store is mutable in memory; prerendering this at build time would freeze the seed state. */
export const dynamic = 'force-dynamic';

export async function GET() {
  const body: StateResponse = {
    rootId: rootId(),
    tree: buildTree(),
    conversations: listConversations(),
  };
  return Response.json(body);
}
