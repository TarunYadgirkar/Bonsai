/**
 * In-memory sliding-window rate limiter, keyed by session + bucket. Per-server-instance only:
 * on serverless each instance keeps its own counters, so this bounds abuse per instance.
 * checkSharedRateLimit counts in Postgres instead, for the buckets where that matters.
 */
import { dbEnabled, sql } from './db';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export type RateLimitBucket = 'inference' | 'mutation' | 'oauth' | 'seed' | 'import' | 'session';

/**
 * inference = routes that can hit a paid model; mutation = cheap state changes. The rest are
 * keyed by client IP, not session, because a cookieless caller mints a fresh session per
 * request and session-keyed limiting never accumulates against it:
 *   oauth   = the unauthenticated DCR/token endpoints;
 *   seed    = writing the Berkeley demo into a garden (~70 rows per seed). Generous enough for a
 *             shared campus NAT where several first visits auto-seed in the same hour;
 *   import  = adding an uploaded garden file (up to a few thousand rows per import);
 *   session = minting a new session on GET /api/state (one root row each).
 */
const LIMITS: Record<RateLimitBucket, { max: number; windowMs: number }> = {
  inference: { max: 20, windowMs: MINUTE_MS },
  mutation: { max: 60, windowMs: MINUTE_MS },
  oauth: { max: 20, windowMs: MINUTE_MS },
  seed: { max: 10, windowMs: HOUR_MS },
  import: { max: 10, windowMs: HOUR_MS },
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

export type RateLimitResult = ReturnType<typeof checkRateLimit>;

/**
 * Fixed-window checkRateLimit counted in Postgres (migrations/008), so every serverless
 * instance draws from one allowance. Without a database, or when the query fails, it falls back
 * to the per-instance limiter: degraded, never unlimited.
 */
export async function checkSharedRateLimit(identity: string, bucket: RateLimitBucket): Promise<RateLimitResult> {
  if (!dbEnabled()) return checkRateLimit(identity, bucket);
  const { max, windowMs } = LIMITS[bucket];
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  try {
    const rows = await sql()`
      INSERT INTO rate_limits (key, window_start, hits)
      VALUES (${`${bucket}:${identity}`}, ${new Date(windowStart).toISOString()}, 1)
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN rate_limits.window_start = EXCLUDED.window_start THEN rate_limits.hits + 1 ELSE 1 END,
        window_start = EXCLUDED.window_start
      RETURNING hits
    `;
    const hits = Number(rows[0]?.hits ?? 1);
    if (hits <= max) return { ok: true };
    return { ok: false, retryAfterSeconds: Math.ceil((windowStart + windowMs - now) / 1000) };
  } catch (err) {
    console.warn(`[rate-limit] shared counter unavailable (${(err as Error).message}) — per-instance limit`);
    return checkRateLimit(identity, bucket);
  }
}
