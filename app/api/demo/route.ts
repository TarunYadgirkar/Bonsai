import { DemoRequestSchema, apiError, apiRoute, persistenceError } from '@/lib/api';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { resolveSession, withSession } from '@/lib/session';
import { currentState, isEmptyGarden, seedDemo } from '@/lib/store';
import type { StateResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Seed the Berkeley Clubs demo into the caller's session. Without `replace` this only fills an
 * empty garden (first-visit auto-seed; a second tab gets the existing garden back). With
 * `replace` it clears and rewrites. Every real write is charged to the caller's IP, because a
 * cookieless caller gets a fresh session per request and the session bucket never fills.
 */
export const POST = apiRoute(DemoRequestSchema, async (body, request) => {
  const session = resolveSession(request);
  const limit = checkRateLimit(session.id, 'mutation');
  if (!limit.ok) return apiError(`rate limit exceeded — retry in ${limit.retryAfterSeconds}s`, 429);
  try {
    const replace = body.replace === true;
    if (!replace) {
      const existing = await currentState(session.id);
      if (!isEmptyGarden(existing)) {
        return withSession(Response.json(existing satisfies StateResponse), session);
      }
    }
    const seedLimit = checkRateLimit(clientIp(request), 'seed');
    if (!seedLimit.ok) {
      return apiError(
        `Too many example trees from this network. Try again in ${Math.ceil(seedLimit.retryAfterSeconds / 60)} min.`,
        429,
      );
    }
    const { state } = await seedDemo(session.id, { replace });
    return withSession(Response.json(state satisfies StateResponse), session);
  } catch (err) {
    console.warn(`[demo] seed failed (${(err as Error).message})`);
    return persistenceError();
  }
});
