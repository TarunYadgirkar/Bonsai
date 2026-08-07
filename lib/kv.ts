/**
 * Durable snapshot storage for lib/store.ts. Two interchangeable backends, picked by env:
 *
 * - Neon Postgres (`DATABASE_URL`) — the one we provision. HTTP driver, no pooling to babysit.
 * - Upstash Redis REST (`UPSTASH_REDIS_REST_*` or `KV_REST_API_*`) — kept because the Vercel
 *   marketplace integration injects those names, so adding it later needs no code change.
 *
 * Neither present means the app runs on globalThis exactly as before, per the AGENTS.md
 * mock-first rule. Every failure here is swallowed and logged: a dead store must degrade to
 * in-memory, never take the demo down (rule 8).
 */
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const TIMEOUT_MS = 3_000;

export function kvEnabled(): boolean {
  return Boolean(DATABASE_URL || (REDIS_URL && REDIS_TOKEN));
}

export function kvBackend(): 'neon' | 'upstash' | 'memory' {
  if (DATABASE_URL) return 'neon';
  if (REDIS_URL && REDIS_TOKEN) return 'upstash';
  return 'memory';
}

/**
 * A miss and a failure must stay distinguishable. Collapsing both to null lets one transient
 * read error convince loadStore() the store is empty, which overwrites a live tree with a fresh
 * fixture — the tree vanishing mid-demo is the exact failure this whole file exists to prevent.
 */
export type KvRead =
  | { status: 'hit'; value: string }
  | { status: 'miss' }
  | { status: 'error' };

export async function kvGet(key: string): Promise<KvRead> {
  try {
    const value = DATABASE_URL
      ? await neonGet(key)
      : REDIS_URL && REDIS_TOKEN
        ? await redisGet(key)
        : null;
    return value === null ? { status: 'miss' } : { status: 'hit', value };
  } catch (err) {
    console.warn(`[kv] get failed (${(err as Error).message}) — continuing from memory`);
    return { status: 'error' };
  }
}

export async function kvSet(key: string, value: string): Promise<boolean> {
  try {
    if (DATABASE_URL) return await neonSet(key, value);
    if (REDIS_URL && REDIS_TOKEN) return await redisSet(key, value);
    return false;
  } catch (err) {
    console.warn(`[kv] set failed (${(err as Error).message}) — state stayed in memory only`);
    return false;
  }
}

/* ---------- neon ---------- */

async function neonGet(key: string): Promise<string | null> {
  const sql = neon(DATABASE_URL!);
  const rows = (await sql`SELECT value FROM store_snapshot WHERE key = ${key}`) as {
    value: unknown;
  }[];
  if (!rows.length) return null;
  // JSONB comes back parsed; store.ts wants the raw string it wrote.
  return JSON.stringify(rows[0].value);
}

async function neonSet(key: string, value: string): Promise<boolean> {
  const sql = neon(DATABASE_URL!);
  await sql`
    INSERT INTO store_snapshot (key, value, updated_at)
    VALUES (${key}, ${value}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return true;
}

/* ---------- upstash ---------- */

async function redisGet(key: string): Promise<string | null> {
  const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Throw, don't return null: a 5xx is an error, not an empty store.
  if (!res.ok) throw new Error(`upstash get ${res.status}`);
  const body = (await res.json()) as { result?: string | null };
  return body.result ?? null;
}

async function redisSet(key: string, value: string): Promise<boolean> {
  const res = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: value,
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) console.warn(`[kv] upstash set ${res.status} — state stayed in memory only`);
  return res.ok;
}
