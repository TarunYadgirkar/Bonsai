import { timingSafeEqual } from 'crypto';
import { apiError, apiRoute, persistenceError } from '@/lib/api';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveSession, withSession } from '@/lib/session';
import { resetStore } from '@/lib/store';
import type { StateResponse } from '@/lib/types';

function tokenMatches(provided: string | null, required: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(required);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const dynamic = 'force-dynamic';

/**
 * Wipe THIS session's garden back to a single empty root. Scoped to the caller's session, so it
 * can only clear the visitor's own tree — not shared state. The optional BONSAI_RESET_TOKEN gate
 * remains for locked-down deployments; unset keeps the open demo behavior.
 */
export const POST = apiRoute(null, async (_body, request) => {
  const required = process.env.BONSAI_RESET_TOKEN;
  if (required && !tokenMatches(request.headers.get('x-reset-token'), required)) {
    return apiError('reset requires a valid x-reset-token header', 403);
  }
  const session = resolveSession(request);
  const limit = checkRateLimit(session.id, 'mutation');
  if (!limit.ok) return apiError(`rate limit exceeded — retry in ${limit.retryAfterSeconds}s`, 429);
  try {
    const state = await resetStore(session.id);
    return withSession(Response.json(state satisfies StateResponse), session);
  } catch (err) {
    console.warn(`[reset] failed (${(err as Error).message})`);
    return persistenceError();
  }
});
