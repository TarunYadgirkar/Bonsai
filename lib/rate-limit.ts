/**
 * In-memory sliding-window rate limiter, keyed by session + bucket. Per-server-instance only:
 * on serverless each instance keeps its own counters, so this bounds abuse per instance —
 * real distributed limiting would need a shared store (Redis/Postgres).
 */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export type RateLimitBucket = 'inference' | 'mutation' | 'oauth' | 'seed' | 'session';

/**
 * inference = routes that can hit a paid model; mutation = cheap state changes. The rest are
 * keyed by client IP, not session, because a cookieless caller mints a fresh session per
 * request and session-keyed limiting never accumulates against it:
 *   oauth   = the unauthenticated DCR/token endpoints;
 *   seed    = writing the Berkeley demo into a garden (~70 rows per seed). Generous enough for a
 *             shared campus NAT where several first visits auto-seed in the same hour;
 *   session = minting a new session on GET /api/state (one root row each).
 */
const LIMITS: Record<RateLimitBucket, { max: number; windowMs: number }> = {
  inference: { max: 20, windowMs: MINUTE_MS },
  mutation: { max: 60, windowMs: MINUTE_MS },
  oauth: { max: 20, windowMs: MINUTE_MS },
  seed: { max: 10, windowMs: HOUR_MS },
  session: { max: 60, windowMs: HOUR_MS },
};

const windowOf = (key: string): number =>
  LIMITS[key.slice(0, key.indexOf(':')) as RateLimitBucket]?.windowMs ?? MINUTE_MS;

const hits = new Map<string, number[]>();
let lastSweep = 0;

/**
 * Best-effort client IP for the IP-keyed buckets, from the platform's forwarding
 * header. Spoofable in theory, but it's the only signal that survives a cookieless caller; the
 * per-instance caveat already applies. Falls back to a shared bucket so a header-stripped flood
 * still throttles collectively rather than not at all.
 */
export function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Drop windows that have fully expired so the map stays bounded by active sessions. */
function sweep(now: number): void {
  if (now - lastSweep < MINUTE_MS) return;
  lastSweep = now;
  for (const [key, times] of hits) {
    const windowMs = windowOf(key);
    const live = times.filter((t) => now - t < windowMs);
    if (live.length) hits.set(key, live);
    else hits.delete(key);
  }
}

export function checkRateLimit(
  identity: string,
  bucket: RateLimitBucket,
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  sweep(now);
  const key = `${bucket}:${identity}`;
  const { max, windowMs } = LIMITS[bucket];
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return { ok: false, retryAfterSeconds: Math.ceil((recent[0] + windowMs - now) / 1000) };
  }
  hits.set(key, [...recent, now]);
  return { ok: true };
}
