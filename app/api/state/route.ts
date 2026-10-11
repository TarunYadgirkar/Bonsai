import { apiError, apiRoute } from '@/lib/api';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { resolveSession, withSession } from '@/lib/session';
import { buildTree, listConversations, loadWorkingSet } from '@/lib/store';
import type { StateResponse } from '@/lib/types';

/** Store is mutable; prerendering this at build time would freeze the seed state. */
export const dynamic = 'force-dynamic';

export const GET = apiRoute(null, async (_body, request) => {
  const session = resolveSession(request);
  // A new session writes a root row. Browsers keep the cookie and mint once; a cookieless
  // caller mints on every request, so minting is charged to the IP.
  if (session.isNew) {
    const limit = checkRateLimit(clientIp(request), 'session');
    if (!limit.ok) {
      return apiError(`rate limit exceeded — retry in ${limit.retryAfterSeconds}s`, 429);
    }
  }
  const ws = await loadWorkingSet(session.id);
  const body: StateResponse = {
    rootId: ws.rootId,
    tree: buildTree(ws),
    conversations: listConversations(ws),
  };
  return withSession(Response.json(body), session);
});
