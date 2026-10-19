import { apiError, apiRoute, persistenceError } from '@/lib/api';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveSession, withSession } from '@/lib/session';
import { forgetRoutingProfile } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/routing-profile — forget what the router learned from THIS session's overrides,
 * escalations and merges. The garden itself is untouched; /api/reset is the one that clears it.
 */
export const DELETE = apiRoute(null, async (_body, request) => {
  const session = resolveSession(request);
  const limit = checkRateLimit(session.id, 'mutation');
  if (!limit.ok) return apiError(`rate limit exceeded — retry in ${limit.retryAfterSeconds}s`, 429);
  try {
    await forgetRoutingProfile(session.id);
    return withSession(Response.json({ forgotten: true }), session);
  } catch (err) {
    console.warn(`[routing-profile] forget failed (${(err as Error).message})`);
    return persistenceError();
  }
});
