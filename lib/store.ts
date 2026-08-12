/**
 * Working-set store over two backends, scoped per browser session (`lib/session.ts`):
 *
 * - Neon (`DATABASE_URL`): rows per conversation/message/insight/log, every one tagged with the
 *   session that owns it. Each request loads that session's working set, mutates it locally, and
 *   `commit()` flushes only what changed — two requests on different branches (or different
 *   sessions) can no longer clobber each other. Same-row races resolve last-write-wins; message
 *   inserts retry past seq collisions so a racing append shifts position instead of vanishing.
 * - Memory (no env): a per-session working set. `commit()` is a no-op — the map IS the store.
 *
 * A fresh session starts with a single empty root you can chat into; the Berkeley fixture is an
 * opt-in demo (`seedDemo`), not the default. Failure honesty: `commit()` reports 'failed' instead
 * of swallowing (the old silent-degrade trap), and refuses to write a memory-fallback working set
 * back over a database that only failed to read — that would overwrite real rows with seed state.
 */
import {
  availableTokensFor as availableTokensForIn,
  buildTree as buildTreeOf,
  emptyProfile,
  mergeProfiles,
  normalizeProfile,
  prunedPct,
  recordFeedback,
  type RoutingFeedback,
  type RoutingProfile,
} from '@bonsai/engine';
import seed from '@/fixtures/seed-conversation.json';
import tree from '@/fixtures/seed-tree.json';
import { dbEnabled, sql } from './db';
import type {
  BranchNode,
  Conversation,
  InferenceLog,
  Insight,
  Message,
  SeedConversation,
  StateResponse,
} from './types';

export type StoreSource = 'db' | 'memory';

export interface WorkingSet {
  sessionId: string;
  source: StoreSource;
  byId: Map<string, Conversation>;
  rootId: string;
  logs: InferenceLog[];
  /** Message ids already persisted, per conversation — commit() inserts only the delta. */
  persistedMessages: Map<string, Set<string>>;
  persistedInsights: Set<string>;
  dirty: Set<string>;
  newLogs: InferenceLog[];
}

export type CommitOutcome = 'memory' | 'persisted' | 'failed';

function shortId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/* ---------- state shapes ---------- */

interface SessionState {
  conversations: Conversation[];
  logs: InferenceLog[];
  rootId: string;
}

/** A fresh session: one empty root, nothing preloaded. This is the default landing state. */
function emptyState(sessionId: string): SessionState {
  const root: Conversation = {
    id: `root_${sessionId}`,
    title: 'New conversation',
    parentId: null,
    messages: [],
    insights: [],
    pinnedTier: null,
    pinnedMode: null,
    archived: false,
  };
  return { conversations: [root], logs: [], rootId: root.id };
}

interface SeedTree {
  rootInsights?: Insight[];
  branches?: Conversation[];
  logs?: InferenceLog[];
  seq?: number;
}

/**
 * The Berkeley demo, cloned with fresh ids so it can be seeded independently into any session
 * without primary-key collisions and re-seeded cleanly. Every id is regenerated and every
 * cross-reference (parentId, brief.branchId, insight branch/parent, log branchId) is rewritten
 * through the same map.
 */
function buildDemoState(): SessionState {
  const fixture = seed as SeedConversation;
  const preloaded = structuredClone(tree) as SeedTree;
  const berkeleyRoot: Conversation = {
    id: fixture.id,
    title: fixture.title,
    parentId: null,
    profile: fixture.profile,
    messages: structuredClone(fixture.messages),
    insights: preloaded.rootInsights ?? [],
    pinnedTier: null,
    archived: false,
  };
  const source = [berkeleyRoot, ...(preloaded.branches ?? [])];

  const idMap = new Map<string, string>();
  for (const c of source) idMap.set(c.id, shortId('demo'));
  const map = (id: string | null | undefined): string | null =>
    id ? (idMap.get(id) ?? id) : null;

  const conversations: Conversation[] = source.map((c) => ({
    ...c,
    id: idMap.get(c.id)!,
    parentId: map(c.parentId),
    messages: c.messages.map((m) => ({ ...m, id: shortId('msg') })),
    insights: c.insights.map((ins) => ({
      ...ins,
      id: shortId('insight'),
      branchId: map(ins.branchId)!,
      parentId: map(ins.parentId)!,
    })),
    ...(c.brief
      ? { brief: { ...c.brief, id: shortId('brief'), branchId: idMap.get(c.id)! } }
      : {}),
  }));

  const logs = (preloaded.logs ?? []).map((l) => ({
    ...l,
    id: shortId('log'),
    branchId: map(l.branchId)!,
  }));

  return { conversations, logs, rootId: idMap.get(fixture.id)! };
}

/* ---------- memory backend (per session) ---------- */

const GLOBAL_KEY = Symbol.for('bonsai.store.v3');

interface MemoryState {
  byId: Map<string, Conversation>;
  rootId: string;
  logs: InferenceLog[];
}

function memoryMap(): Map<string, MemoryState> {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: Map<string, MemoryState> };
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY];
}

function toMemory(state: SessionState): MemoryState {
  return {
    byId: new Map(state.conversations.map((c) => [c.id, c])),
    rootId: state.rootId,
    logs: state.logs,
  };
}

function memoryState(sessionId: string): MemoryState {
  const map = memoryMap();
  let state = map.get(sessionId);
  if (!state) {
    state = toMemory(emptyState(sessionId));
    map.set(sessionId, state);
  }
  return state;
}

/* ---------- neon backend ---------- */

interface ConversationRow {
  id: string;
  title: string;
  parent_id: string | null;
  profile: Conversation['profile'];
  brief: Conversation['brief'];
  pinned_tier: Conversation['pinnedTier'];
  pinned_mode: Conversation['pinnedMode'];
  archived: boolean;
  is_root: boolean;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: Message['role'];
  content: string;
  routing: Message['routing'];
  created_at: string;
}

interface InsightRow {
  id: string;
  branch_id: string;
  parent_id: string;
  text: string;
  created_at: string;
}

async function ensureSessionRoot(sessionId: string): Promise<void> {
  const root = emptyState(sessionId).conversations[0];
  await upsertConversationRow(sessionId, root, true);
}

async function loadFromDb(sessionId: string, withLogs: boolean): Promise<WorkingSet> {
  const q = sql();
  const existing = (await q`
    SELECT 1 FROM conversations WHERE session_id = ${sessionId} LIMIT 1
  `) as unknown as unknown[];
  if (!existing.length) await ensureSessionRoot(sessionId);
  return loadAssembled(sessionId, withLogs);
}

async function loadAssembled(sessionId: string, withLogs: boolean): Promise<WorkingSet> {
  const q = sql();
  const convRows = (await q`
    SELECT * FROM conversations WHERE session_id = ${sessionId}
  `) as unknown as ConversationRow[];
  const ids = convRows.map((r) => r.id);

  const [msgRows, insightRows, logRows] = await Promise.all([
    ids.length
      ? (q`SELECT * FROM messages WHERE conversation_id = ANY(${ids}::text[]) ORDER BY conversation_id, seq` as unknown as Promise<
          MessageRow[]
        >)
      : Promise.resolve([] as MessageRow[]),
    ids.length
      ? (q`SELECT * FROM insights WHERE parent_id = ANY(${ids}::text[]) ORDER BY created_at` as unknown as Promise<
          InsightRow[]
        >)
      : Promise.resolve([] as InsightRow[]),
    withLogs
      ? (q`SELECT payload FROM inference_logs WHERE session_id = ${sessionId} ORDER BY ts` as unknown as Promise<
          { payload: InferenceLog }[]
        >)
      : Promise.resolve([] as { payload: InferenceLog }[]),
  ]);

  const byId = new Map<string, Conversation>();
  let rootId = '';
  for (const row of convRows) {
    if (row.is_root && !rootId) rootId = row.id;
    byId.set(row.id, {
      id: row.id,
      title: row.title,
      parentId: row.parent_id,
      ...(row.profile ? { profile: row.profile } : {}),
      messages: [],
      ...(row.brief ? { brief: row.brief } : {}),
      insights: [],
      pinnedTier: row.pinned_tier ?? null,
      pinnedMode: row.pinned_mode ?? null,
      archived: row.archived,
    });
  }

  const persistedMessages = new Map<string, Set<string>>();
  for (const m of msgRows) {
    const c = byId.get(m.conversation_id);
    if (!c) continue;
    c.messages.push({
      id: m.id,
      role: m.role,
      content: m.content,
      ...(m.routing ? { routing: m.routing } : {}),
      createdAt: new Date(m.created_at).toISOString(),
    });
    const set = persistedMessages.get(m.conversation_id) ?? new Set();
    set.add(m.id);
    persistedMessages.set(m.conversation_id, set);
  }

  const persistedInsights = new Set<string>();
  for (const i of insightRows) {
    byId.get(i.parent_id)?.insights.push({
      id: i.id,
      branchId: i.branch_id,
      parentId: i.parent_id,
      text: i.text,
      createdAt: new Date(i.created_at).toISOString(),
    });
    persistedInsights.add(i.id);
  }

  return {
    sessionId,
    source: 'db',
    byId,
    rootId: rootId || convRows[0]?.id || `root_${sessionId}`,
    logs: logRows.map((r) => r.payload),
    persistedMessages,
    persistedInsights,
    dirty: new Set(),
    newLogs: [],
  };
}

async function upsertConversationRow(
  sessionId: string,
  c: Conversation,
  isRoot: boolean,
): Promise<void> {
  const q = sql();
  await q`
    INSERT INTO conversations (id, session_id, title, parent_id, profile, brief, pinned_tier, pinned_mode, archived, is_root, updated_at)
    VALUES (${c.id}, ${sessionId}, ${c.title}, ${c.parentId}, ${JSON.stringify(c.profile ?? null)}::jsonb,
            ${JSON.stringify(c.brief ?? null)}::jsonb, ${c.pinnedTier},
            ${JSON.stringify(c.pinnedMode ?? null)}::jsonb, ${c.archived}, ${isRoot}, now())
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title, brief = EXCLUDED.brief, pinned_tier = EXCLUDED.pinned_tier,
      pinned_mode = EXCLUDED.pinned_mode, archived = EXCLUDED.archived, updated_at = now()
  `;
}

/** Insert at the local index; on a seq race, retry landing after whatever got there first. */
async function insertMessageRow(conversationId: string, m: Message, seq: number): Promise<void> {
  const q = sql();
  try {
    await q`
      INSERT INTO messages (id, conversation_id, seq, role, content, routing)
      VALUES (${m.id}, ${conversationId}, ${seq}, ${m.role}, ${m.content},
              ${JSON.stringify(m.routing ?? null)}::jsonb)
      ON CONFLICT (id) DO NOTHING
    `;
    return;
  } catch {
    // seq collision — fall through to the atomic append below.
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await q`
        INSERT INTO messages (id, conversation_id, seq, role, content, routing)
        SELECT ${m.id}, ${conversationId}, COALESCE(MAX(seq), -1) + 1, ${m.role}, ${m.content},
               ${JSON.stringify(m.routing ?? null)}::jsonb
        FROM messages WHERE conversation_id = ${conversationId}
        ON CONFLICT (id) DO NOTHING
      `;
      return;
    } catch (err) {
      if (attempt === 4) throw err;
    }
  }
}

async function insertInsightRow(i: Insight): Promise<void> {
  const q = sql();
  await q`
    INSERT INTO insights (id, branch_id, parent_id, text)
    VALUES (${i.id}, ${i.branchId}, ${i.parentId}, ${i.text})
    ON CONFLICT (id) DO NOTHING
  `;
}

function depthIn(all: Conversation[], c: Conversation): number {
  let depth = 0;
  let cursor = c.parentId;
  const byId = new Map(all.map((x) => [x.id, x]));
  while (cursor) {
    depth += 1;
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return depth;
}

/** Write a whole session state to the database, parents before children so the FK holds. */
async function writeSessionToDb(sessionId: string, state: SessionState): Promise<void> {
  const q = sql();
  const ordered = [...state.conversations].sort(
    (a, b) => depthIn(state.conversations, a) - depthIn(state.conversations, b),
  );
  for (const c of ordered) {
    await upsertConversationRow(sessionId, c, c.id === state.rootId);
    for (const [i, m] of c.messages.entries()) await insertMessageRow(c.id, m, i);
    for (const ins of c.insights) await insertInsightRow(ins);
  }
  for (const log of state.logs) {
    await q`
      INSERT INTO inference_logs (id, session_id, branch_id, payload)
      VALUES (${log.id}, ${sessionId}, ${log.branchId}, ${JSON.stringify(log)}::jsonb)
      ON CONFLICT (id) DO NOTHING
    `;
  }
}

async function clearSessionInDb(sessionId: string): Promise<void> {
  const q = sql();
  await q`DELETE FROM inference_logs WHERE session_id = ${sessionId}`;
  await q`DELETE FROM insights WHERE parent_id IN (SELECT id FROM conversations WHERE session_id = ${sessionId})`;
  await q`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE session_id = ${sessionId})`;
  await q`DELETE FROM conversations WHERE session_id = ${sessionId}`;
}

/* ---------- public API ---------- */

export async function loadWorkingSet(
  sessionId: string,
  opts?: { withLogs?: boolean },
): Promise<WorkingSet> {
  const withLogs = opts?.withLogs ?? false;
  if (dbEnabled()) {
    try {
      return await loadFromDb(sessionId, withLogs);
    } catch (err) {
      console.warn(`[store] db load failed (${(err as Error).message}) — memory working set`);
    }
  }
  const mem = memoryState(sessionId);
  return {
    sessionId,
    source: 'memory',
    byId: mem.byId,
    rootId: mem.rootId,
    logs: mem.logs,
    persistedMessages: new Map(),
    persistedInsights: new Set(),
    dirty: new Set(),
    newLogs: [],
  };
}

export function newId(prefix: string): string {
  // Full 128-bit UUID, not a truncation: message inserts use ON CONFLICT (id) DO NOTHING, so a
  // shortened id that collided would silently drop the message while the commit reported success.
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function getConversation(ws: WorkingSet, id: string): Conversation | undefined {
  return ws.byId.get(id);
}

export function listConversations(ws: WorkingSet): Conversation[] {
  return [...ws.byId.values()];
}

export function putConversation(ws: WorkingSet, conversation: Conversation): void {
  ws.byId.set(conversation.id, conversation);
  ws.dirty.add(conversation.id);
}

export function updateConversation(
  ws: WorkingSet,
  id: string,
  patch: (c: Conversation) => Conversation,
): Conversation | undefined {
  const current = ws.byId.get(id);
  if (!current) return undefined;
  const next = patch(current);
  ws.byId.set(id, next);
  ws.dirty.add(id);
  return next;
}

export function appendMessage(
  ws: WorkingSet,
  id: string,
  message: Message,
): Conversation | undefined {
  return updateConversation(ws, id, (c) => ({ ...c, messages: [...c.messages, message] }));
}

export function appendInsight(
  ws: WorkingSet,
  parentId: string,
  insight: Insight,
): Conversation | undefined {
  return updateConversation(ws, parentId, (c) => ({ ...c, insights: [...c.insights, insight] }));
}

export function logInference(ws: WorkingSet, log: InferenceLog): InferenceLog {
  ws.logs.push(log);
  ws.newLogs.push(log);
  return log;
}

/** Flush local mutations. 'failed' means a configured database did not (or must not) take them. */
export async function commit(ws: WorkingSet): Promise<CommitOutcome> {
  if (!dbEnabled()) return 'memory';
  // A working set that fell back to memory because the DB failed to READ must never be written
  // back — that would overwrite real rows with seed/empty state. Refuse instead of lying.
  if (ws.source !== 'db') return 'failed';
  try {
    const q = sql();
    for (const id of ws.dirty) {
      const c = ws.byId.get(id);
      if (!c) continue;
      await upsertConversationRow(ws.sessionId, c, id === ws.rootId);
      const persisted = ws.persistedMessages.get(id) ?? new Set();
      for (const [i, m] of c.messages.entries()) {
        if (persisted.has(m.id)) continue;
        await insertMessageRow(id, m, i);
        persisted.add(m.id);
      }
      ws.persistedMessages.set(id, persisted);
      for (const ins of c.insights) {
        if (ws.persistedInsights.has(ins.id)) continue;
        await insertInsightRow(ins);
        ws.persistedInsights.add(ins.id);
      }
    }
    for (const log of ws.newLogs) {
      await q`
        INSERT INTO inference_logs (id, session_id, branch_id, payload)
        VALUES (${log.id}, ${ws.sessionId}, ${log.branchId}, ${JSON.stringify(log)}::jsonb)
        ON CONFLICT (id) DO NOTHING
      `;
    }
    ws.dirty.clear();
    ws.newLogs = [];
    return 'persisted';
  } catch (err) {
    console.warn(`[store] commit failed (${(err as Error).message}) — writes not persisted`);
    return 'failed';
  }
}

async function replaceSession(sessionId: string, state: SessionState): Promise<StateResponse> {
  if (dbEnabled()) {
    await clearSessionInDb(sessionId);
    await writeSessionToDb(sessionId, state);
  }
  memoryMap().set(sessionId, toMemory(state));
  const ws = await loadWorkingSet(sessionId);
  return { rootId: ws.rootId, tree: buildTree(ws), conversations: listConversations(ws) };
}

/** Wipe the session back to a single empty root. Surfaces DB failure instead of faking success. */
export async function resetStore(sessionId: string): Promise<StateResponse> {
  return replaceSession(sessionId, emptyState(sessionId));
}

/** Seed the Berkeley demo into this session (replacing whatever was there). */
export async function seedDemo(sessionId: string): Promise<StateResponse> {
  return replaceSession(sessionId, buildDemoState());
}

/* ---------- learned routing profile (per session) ---------- */

const PROFILE_GLOBAL = Symbol.for('bonsai.profile.v2');

function profileMap(): Map<string, RoutingProfile> {
  const g = globalThis as typeof globalThis & { [PROFILE_GLOBAL]?: Map<string, RoutingProfile> };
  if (!g[PROFILE_GLOBAL]) g[PROFILE_GLOBAL] = new Map();
  return g[PROFILE_GLOBAL];
}

function memoryProfile(sessionId: string): RoutingProfile {
  const map = profileMap();
  let profile = map.get(sessionId);
  if (!profile) {
    profile = emptyProfile();
    map.set(sessionId, profile);
  }
  return profile;
}

export async function loadProfile(sessionId: string): Promise<RoutingProfile> {
  if (dbEnabled()) {
    try {
      const rows = (await sql()`
        SELECT profile FROM routing_profiles WHERE id = ${sessionId}
      `) as unknown as { profile: unknown }[];
      if (rows.length) return normalizeProfile(rows[0].profile);
      return emptyProfile();
    } catch (err) {
      console.warn(`[store] profile load failed (${(err as Error).message}) — memory profile`);
    }
  }
  return memoryProfile(sessionId);
}

/**
 * Fold one behavioral signal into the session's profile and persist it. Never throws — routing
 * must not break because a learning write failed. This is a read-modify-write; the HTTP driver
 * runs each statement in its own transaction, so truly concurrent writes on the SAME session
 * resolve last-write-wins. That contention is negligible now the profile is per browser session
 * (one visitor rarely fires two learning writes at once), so it stays a plain fold rather than a
 * heavier locking scheme.
 */
export async function recordRoutingFeedback(
  sessionId: string,
  event: RoutingFeedback,
): Promise<void> {
  const current = await loadProfile(sessionId);
  const next = recordFeedback(current, event);
  if (dbEnabled()) {
    try {
      await sql()`
        INSERT INTO routing_profiles (id, profile, updated_at)
        VALUES (${sessionId}, ${JSON.stringify(next)}::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()
      `;
      return;
    } catch (err) {
      console.warn(`[store] profile save failed (${(err as Error).message})`);
    }
  }
  profileMap().set(sessionId, next);
}

/* ---------- population prior (community cold-start) ---------- */

/** Fewer contributors than this and no prior is served — one user's counters must never be
 *  readable back out of the "community" aggregate. */
const MIN_PRIOR_CONTRIBUTORS = 3;
/** How many most-recent profiles feed the fold — recency keeps the prior current and bounds work. */
const PRIOR_SAMPLE_LIMIT = 1000;
const PRIOR_TTL_MS = 60_000;
const PRIOR_GLOBAL = Symbol.for('bonsai.population.v1');

export interface PopulationPrior {
  contributors: number;
  /** Null until enough distinct sessions have contributed, and always null without a database. */
  prior: RoutingProfile | null;
}

interface PriorCache {
  at: number;
  value: PopulationPrior;
}

function priorCache(): { get: () => PriorCache | undefined; set: (v: PriorCache) => void } {
  const g = globalThis as typeof globalThis & { [PRIOR_GLOBAL]?: PriorCache };
  return { get: () => g[PRIOR_GLOBAL], set: (v) => void (g[PRIOR_GLOBAL] = v) };
}

/**
 * The community's collective routing memory: every session's learned profile summed into one
 * anonymous aggregate (`mergeProfiles`), served to the router as the cold-start for sessions that
 * have no history of their own. Only behavioral counters are aggregated — no session ids, no text
 * — and nothing is served until MIN_PRIOR_CONTRIBUTORS distinct sessions have contributed.
 * Cached per instance for PRIOR_TTL_MS; failure serves no prior rather than stale panic.
 */
export async function loadPopulationPrior(): Promise<PopulationPrior> {
  const none: PopulationPrior = { contributors: 0, prior: null };
  if (!dbEnabled()) return none;
  const cache = priorCache();
  const hit = cache.get();
  if (hit && Date.now() - hit.at < PRIOR_TTL_MS) return hit.value;
  try {
    const rows = (await sql()`
      SELECT profile FROM routing_profiles ORDER BY updated_at DESC LIMIT ${PRIOR_SAMPLE_LIMIT}
    `) as unknown as { profile: unknown }[];
    const value: PopulationPrior =
      rows.length >= MIN_PRIOR_CONTRIBUTORS
        ? {
            contributors: rows.length,
            prior: mergeProfiles(rows.map((r) => r.profile as RoutingProfile)),
          }
        : { contributors: rows.length, prior: null };
    cache.set({ at: Date.now(), value });
    return value;
  } catch (err) {
    console.warn(`[store] population prior load failed (${(err as Error).message}) — no prior`);
    return none;
  }
}

/* ---------- derived ---------- */

export function availableTokensFor(
  ws: WorkingSet,
  parentId: string | null,
  anchorMessageId?: string,
): number {
  return availableTokensForIn(parentId, (id) => ws.byId.get(id), anchorMessageId);
}

export function buildTree(ws: WorkingSet): BranchNode[] {
  return buildTreeOf(listConversations(ws));
}

export { prunedPct };
