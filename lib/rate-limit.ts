/**
 * In-memory sliding-window rate limiter, keyed by session + bucket. Per-server-instance only:
 * on serverless each instance keeps its own counters, so this bounds abuse per instance —
 * real distributed limiting would need a shared store (Redis/Postgres).
 */
const WINDOW_MS = 60_000;

export type RateLimitBucket = 'inference' | 'mutation' | 'oauth';

/**
 * inference = routes that can hit a paid model; mutation = cheap state changes; oauth = the
 * unauthenticated DCR/token endpoints (keyed by client IP, not session — a cookieless caller
 * mints a fresh session per request, so session-keyed limiting never accumulates against it).
 */
const LIMITS: Record<RateLimitBucket, number> = {
  inference: 20,
  mutation: 60,
  oauth: 20,
};

const hits = new Map<string, number[]>();
let lastSweep = 0;

/**
 * Best-effort client IP for the unauthenticated OAuth endpoints, from the platform's forwarding
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
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, times] of hits) {
    const live = times.filter((t) => now - t < WINDOW_MS);
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
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMITS[bucket]) {
    hits.set(key, recent);
    return { ok: false, retryAfterSeconds: Math.ceil((recent[0] + WINDOW_MS - now) / 1000) };
  }
  hits.set(key, [...recent, now]);
  return { ok: true };
}
