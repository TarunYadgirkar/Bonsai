import { apiError, apiRoute } from '@/lib/api';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveSession, withSession } from '@/lib/session';
import { issueKeyForSession, storeMode } from '@/lib/mcp-store';

export const dynamic = 'force-dynamic';

/**
 * Self-serve connector onboarding: mint (or return) this browser session's garden key so a
 * stranger can attach Bonsai to their claude.ai without anyone handing keys around. One key per
 * session — repeat calls are idempotent — and the mutation rate limit bounds mint abuse.
 */
export const POST = apiRoute(null, async (_body, request) => {
  const session = resolveSession(request);
  const limit = checkRateLimit(session.id, 'mutation');
  if (!limit.ok) {
    return apiError(`rate limit exceeded — retry in ${limit.retryAfterSeconds}s`, 429);
  }
  try {
    const key = issueKeyForSession(session.id);
    const resolved = await key;
    const origin = new URL(request.url).origin;
    return withSession(
      Response.json({
        key: resolved,
        url: `${origin}/api/mcp/${resolved}`,
        mode: storeMode(),
      }),
      session,
    );
  } catch (err) {
    console.warn(`[connect] key issue failed (${(err as Error).message})`);
    return apiError('could not issue a connector key — try again shortly', 503);
  }
});
