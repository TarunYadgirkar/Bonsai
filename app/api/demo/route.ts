import { apiError, apiRoute, persistenceError } from '@/lib/api';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveSession, withSession } from '@/lib/session';
import { seedDemo } from '@/lib/store';
import type { StateResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Seed the Berkeley Clubs demo into the caller's session, replacing whatever was there. The demo
 * is opt-in — a fresh visitor lands on an empty root and only pulls the fixture in from here.
 */
export const POST = apiRoute(null, async (_body, request) => {
  const session = resolveSession(request);
  const limit = checkRateLimit(session.id, 'mutation');
  if (!limit.ok) return apiError(`rate limit exceeded — retry in ${limit.retryAfterSeconds}s`, 429);
  try {
    const state = await seedDemo(session.id);
    return withSession(Response.json(state satisfies StateResponse), session);
  } catch (err) {
    console.warn(`[demo] seed failed (${(err as Error).message})`);
    return persistenceError();
  }
});
