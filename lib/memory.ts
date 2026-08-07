/**
 * EverMind EverOS durable memory. Contract per docs/evermind-official-api.md (v2 — v1 is legacy).
 *
 * Every call falls back to a local JSON store when the key is missing or the API errors,
 * so the DEMO.md script is walkable with zero keys configured (AGENTS.md, mock-first rule).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.EVERMIND_BASE_URL ?? 'https://api.evermind.ai';
/** `.env.example` declares EVERMIND_API_KEY; EverOS's own tooling uses EVEROS_API_KEY. Accept both. */
const API_KEY = process.env.EVERMIND_API_KEY ?? process.env.EVEROS_API_KEY;
const TIMEOUT_MS = 8000;
const LOCAL_PATH = path.join(process.cwd(), 'data', 'memory.json');

export type MemoryRole = 'user' | 'assistant' | 'tool';

export interface MemoryMessage {
  sender_id: string;
  role: MemoryRole;
  timestamp: number;
  content: string;
  sender_name?: string;
}

export interface MemoryHit {
  id: string;
  text: string;
  score: number;
  sessionId?: string;
}

interface LocalRecord {
  id: string;
  userId: string;
  sessionId: string;
  text: string;
  ts: number;
}

interface SearchData {
  episodes?: Array<{
    id: string;
    summary?: string;
    episode?: string;
    score?: number;
    session_id?: string;
  }>;
  unprocessed_messages?: Array<{ id: string; content: string; session_id?: string }>;
}

/** Stable owner id for every memory Bonsai writes. Matches the test id in docs/evermind-official-v2.md. */
export const MEMORY_USER_ID = 'bonsai_tarun';

export function isRemoteEnabled(): boolean {
  return Boolean(API_KEY);
}

async function post<T>(endpoint: string, body: unknown): Promise<T | null> {
  if (!API_KEY) return null;
  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[memory] ${endpoint} ${res.status} — falling back to local store`);
      return null;
    }
    const json = (await res.json()) as { data?: T };
    return json.data ?? null;
  } catch (err) {
    console.warn(`[memory] ${endpoint} failed (${(err as Error).message}) — falling back to local store`);
    return null;
  }
}

/* ---------- local fallback ---------- */

async function readLocal(): Promise<LocalRecord[]> {
  try {
    return JSON.parse(await fs.readFile(LOCAL_PATH, 'utf8')) as LocalRecord[];
  } catch {
    return [];
  }
}

async function writeLocal(records: LocalRecord[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
    await fs.writeFile(LOCAL_PATH, JSON.stringify(records, null, 2));
  } catch (err) {
    // Vercel's filesystem is read-only outside /tmp; losing the local mirror is survivable.
    console.warn(`[memory] local write skipped (${(err as Error).message})`);
  }
}

function localSearch(records: LocalRecord[], query: string, userId: string, topK: number): MemoryHit[] {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  return records
    .filter((r) => r.userId === userId)
    .map((r) => {
      const haystack = r.text.toLowerCase();
      const matches = terms.filter((t) => haystack.includes(t)).length;
      return { id: r.id, text: r.text, score: terms.length ? matches / terms.length : 0, sessionId: r.sessionId };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/* ---------- public API ---------- */

/** Ingest messages for extraction. `flush` forces immediate extraction — the demo can't wait on the queue. */
export async function addMemories(params: {
  sessionId: string;
  userId: string;
  messages: MemoryMessage[];
  flush?: boolean;
}): Promise<{ remote: boolean }> {
  const { sessionId, userId, messages } = params;

  const data = await post<{ status: string }>('/api/v2/memory/add', {
    session_id: sessionId,
    messages,
    async_mode: false,
  });

  if (data && params.flush) {
    await post<{ status: string }>('/api/v2/memory/flush', { session_id: sessionId });
  }

  const records = await readLocal();
  await writeLocal([
    ...records,
    ...messages.map((m, i) => ({
      id: `local_${sessionId}_${m.timestamp}_${i}`,
      userId,
      sessionId,
      text: m.content,
      ts: m.timestamp,
    })),
  ]);

  return { remote: data !== null };
}

/** Store a merged insight as a durable memory attributed to the user. */
export async function writeInsight(params: {
  userId: string;
  branchId: string;
  text: string;
}): Promise<{ remote: boolean }> {
  return addMemories({
    sessionId: params.branchId,
    userId: params.userId,
    flush: true,
    messages: [
      {
        sender_id: params.userId,
        role: 'user',
        timestamp: Date.now(),
        content: params.text,
      },
    ],
  });
}

/** Retrieve memories relevant to a branch topic, for compileBrief to fold into the brief. */
export async function searchMemories(params: {
  query: string;
  userId: string;
  topK?: number;
  /**
   * Pin one session to also read its in-flight buffer. Must stay a top-level scalar —
   * wrapping it in AND/OR or an operator map silently returns [] (docs/evermind-official-v2.md).
   */
  sessionId?: string;
}): Promise<MemoryHit[]> {
  const topK = params.topK ?? 5;

  const data = await post<SearchData>('/api/v2/memory/search', {
    query: params.query,
    user_id: params.userId,
    method: 'hybrid',
    top_k: topK,
    include_profile: true,
    ...(params.sessionId ? { filters: { session_id: params.sessionId } } : {}),
  });

  const episodes = (data?.episodes ?? []).map((e) => ({
    id: e.id,
    text: e.summary ?? e.episode ?? '',
    score: e.score ?? 0,
    sessionId: e.session_id,
  }));

  // Extraction is async: a just-merged insight is still "accumulated", not an episode yet.
  // The raw buffer is the only way to read it back inside a demo beat.
  const buffered = (data?.unprocessed_messages ?? []).map((m) => ({
    id: m.id,
    text: m.content,
    score: 0,
    sessionId: m.session_id,
  }));

  const hits = [...episodes, ...buffered];
  if (hits.length) return hits.slice(0, topK);

  return localSearch(await readLocal(), params.query, params.userId, topK);
}
