import { persistenceErrorResponse } from '@/app/api/persistence-response';
import {
  buildTree,
  listConversations,
  loadStore,
  persistenceStatus,
  rootId,
} from '@/lib/store';
import type { StateResponse } from '@/lib/types';

/** Store is mutable in memory; prerendering this at build time would freeze the seed state. */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await loadStore();
  } catch (error: unknown) {
    const response = persistenceErrorResponse(error);
    if (response) return response;
    throw error;
  }
  const body: StateResponse = {
    rootId: rootId(),
    tree: buildTree(),
    conversations: listConversations(),
    persistence: persistenceStatus(),
  };
  return Response.json(body);
}
