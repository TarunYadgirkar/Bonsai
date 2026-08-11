import { timingSafeEqual } from 'crypto';
import { apiError, apiRoute } from '@/lib/api';
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
 * Put the demo back to its opening state: the seeded root plus the pre-built scenario tree.
 *
 * A destructive wipe of shared state, so it is gateable: set BONSAI_RESET_TOKEN and the route
 * requires a matching x-reset-token header. Unset (dev, keyless demo) keeps the open behavior.
 */
export const POST = apiRoute(null, async (_body, request) => {
  const required = process.env.BONSAI_RESET_TOKEN;
  if (required && !tokenMatches(request.headers.get('x-reset-token'), required)) {
    return apiError('reset requires a valid x-reset-token header', 403);
  }
  const state = await resetStore();
  return Response.json(state satisfies StateResponse);
});
