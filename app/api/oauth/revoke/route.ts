import { apiError, apiRoute } from '@/lib/api';
import { revokeTokensForKey } from '@/lib/oauth';
import { checkRateLimit } from '@/lib/rate-limit';
import { issueKeyForSession } from '@/lib/mcp-store';
import { resolveSession, withSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Sever every OAuth grant on this browser session's garden — the honest revocation the consent
 * page promises. Scoped to the caller's own key (same session identity that minted it), so one
 * visitor can never revoke another's connectors.
 */
export const POST = apiRoute(null, async (_body, request) => {
  const session = resolveSession(request);
  const limit = checkRateLimit(session.id, 'mutation');
  if (!limit.ok) return apiError(`rate limit exceeded — retry in ${limit.retryAfterSeconds}s`, 429);
  try {
    const key = await issueKeyForSession(session.id);
    const revoked = await revokeTokensForKey(key);
    return withSession(Response.json({ revoked }), session);
  } catch (err) {
    console.warn(`[oauth] revoke failed (${(err as Error).message})`);
    return apiError('could not revoke — try again shortly', 503);
  }
});
