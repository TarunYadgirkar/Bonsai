/**
 * Upstash Redis over REST — plain fetch, no SDK.
 *
 * Only used to keep the tree alive across Vercel instances (see lib/store.ts). Absent env vars
 * mean the app runs exactly as before on globalThis, per the AGENTS.md mock-first rule.
 *
 * Both env-var pairs are accepted: the Vercel marketplace Upstash integration injects
 * UPSTASH_REDIS_REST_*, while Vercel KV projects inject KV_REST_API_*.
 */
const URL_ENV = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const TOKEN_ENV = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const TIMEOUT_MS = 3_000;

export function kvEnabled(): boolean {
  return Boolean(URL_ENV && TOKEN_ENV);
}

/** Returns null on miss AND on any failure — a dead KV must never take the demo down. */
export async function kvGet(key: string): Promise<string | null> {
  if (!kvEnabled()) return null;
  try {
    const res = await fetch(`${URL_ENV}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${TOKEN_ENV}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[kv] get ${res.status} — continuing from memory`);
      return null;
    }
    const body = (await res.json()) as { result?: string | null };
    return body.result ?? null;
  } catch (err) {
    console.warn(`[kv] get failed (${(err as Error).message}) — continuing from memory`);
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<boolean> {
  if (!kvEnabled()) return false;
  try {
    const res = await fetch(`${URL_ENV}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN_ENV}` },
      body: value,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) console.warn(`[kv] set ${res.status} — state stayed in memory only`);
    return res.ok;
  } catch (err) {
    console.warn(`[kv] set failed (${(err as Error).message}) — state stayed in memory only`);
    return false;
  }
}
