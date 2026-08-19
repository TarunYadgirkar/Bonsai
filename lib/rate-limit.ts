/**
 * In-memory sliding-window rate limiter, keyed by session + bucket. Per-server-instance only:
 * on serverless each instance keeps its own counters, so this bounds abuse per instance —
 * real distributed limiting would need a shared store (Redis/Postgres).
 */
const WINDOW_MS = 60_000;

export type RateLimitBucket = 'inference' | 'mutation';

/** inference = routes that can hit a paid model; mutation = cheap state changes. */
const LIMITS: Record<RateLimitBucket, number> = {
  inference: 20,
  mutation: 60,
};

const hits = new Map<string, number[]>();
let lastSweep = 0;

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
  sessionId: string,
  bucket: RateLimitBucket,
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  sweep(now);
  const key = `${bucket}:${sessionId}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMITS[bucket]) {
    hits.set(key, recent);
    return { ok: false, retryAfterSeconds: Math.ceil((recent[0] + WINDOW_MS - now) / 1000) };
  }
  hits.set(key, [...recent, now]);
  return { ok: true };
}
