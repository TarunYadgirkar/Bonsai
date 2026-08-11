/**
 * Working-set store over two backends:
 *
 * - Neon (`DATABASE_URL`): rows per conversation/message/insight/log. Each request loads the
 *   working set, mutates it locally, and `commit()` flushes only what changed — two requests on
 *   different branches can no longer clobber each other the way the old whole-snapshot blob
 *   did. Same-row races resolve last-write-wins; message inserts retry past seq collisions so
 *   a racing append shifts position instead of vanishing.
 * - Memory (no env): a module-global working set seeded from the fixtures, exactly the old
 *   behavior. `commit()` is a no-op — the map IS the store. Keyless dev stays zero-config.
 *
 * Failure honesty: `commit()` reports 'failed' instead of swallowing, so mutating routes can
 * stop returning 200 for writes that evaporated (the old silent-degrade trap).
 */
import {
  availableTokensFor as availableTokensForIn,
  buildTree as buildTreeOf,
  prunedPct,
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

export interface WorkingSet {
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

/* ---------- fixture seed ---------- */

interface SeedTree {
  rootInsights?: Insight[];
  branches?: Conversation[];
  logs?: InferenceLog[];
  seq?: number;
}

function buildSeedState(): { conversations: Conversation[]; logs: InferenceLog[]; rootId: string } {
  const fixture = seed as SeedConversation;
  // Clone: an imported JSON module is a live singleton and must never be mutated in place.
  const preloaded = structuredClone(tree) as SeedTree;
  const root: Conversation = {
    id: fixture.id,
    title: fixture.title,
    parentId: null,
    profile: fixture.profile,
    messages: structuredClone(fixture.messages),
    insights: preloaded.rootInsights ?? [],
    pinnedTier: null,
    archived: false,
  };
  return {
    conversations: [root, ...(preloaded.branches ?? [])],
    logs: preloaded.logs ?? [],
    rootId: root.id,
  };
}

/* ---------- memory backend ---------- */

const GLOBAL_KEY = Symbol.for('bonsai.store.v2');

interface MemoryState {
  byId: Map<string, Conversation>;
  rootId: string;
  logs: InferenceLog[];
}

function memoryState(): MemoryState {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: MemoryState };
  if (!g[GLOBAL_KEY]) {
    const seeded = buildSeedState();
    g[GLOBAL_KEY] = {
      byId: new Map(seeded.conversations.map((c) => [c.id, c])),
      rootId: seeded.rootId,
      logs: seeded.logs,
    };
  }
  return g[GLOBAL_KEY];
}

function resetMemory(): void {
  (globalThis as typeof globalThis & { [GLOBAL_KEY]?: MemoryState })[GLOBAL_KEY] = undefined;
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

async function loadFromDb(withLogs: boolean): Promise<WorkingSet | null> {
  const q = sql();
  const conversations = (await q`SELECT * FROM conversations`) as unknown as ConversationRow[];
  if (!conversations.length) {
    await seedDb();
    return loadAssembled(withLogs);
  }
  return loadAssembled(withLogs);
}

async function loadAssembled(withLogs: boolean): Promise<WorkingSet> {
  const q = sql();
  const [convRows, msgRows, insightRows, logRows] = await Promise.all([
    q`SELECT * FROM conversations` as unknown as Promise<ConversationRow[]>,
    q`SELECT * FROM messages ORDER BY conversation_id, seq` as unknown as Promise<MessageRow[]>,
    q`SELECT * FROM insights ORDER BY created_at` as unknown as Promise<InsightRow[]>,
    withLogs
      ? (q`SELECT payload FROM inference_logs ORDER BY ts` as unknown as Promise<
          { payload: InferenceLog }[]
        >)
      : Promise.resolve([]),
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
    byId,
    rootId: rootId || convRows[0]?.id || '',
    logs: logRows.map((r) => r.payload),
    persistedMessages,
    persistedInsights,
    dirty: new Set(),
    newLogs: [],
  };
}

async function upsertConversationRow(c: Conversation, isRoot: boolean): Promise<void> {
  const q = sql();
  await q`
    INSERT INTO conversations (id, title, parent_id, profile, brief, pinned_tier, pinned_mode, archived, is_root, updated_at)
    VALUES (${c.id}, ${c.title}, ${c.parentId}, ${JSON.stringify(c.profile ?? null)}::jsonb,
            ${JSON.stringify(c.brief ?? null)}::jsonb, ${c.pinnedTier},
            ${JSON.stringify(c.pinnedMode ?? null)}::jsonb, ${c.archived}, ${isRoot}, now())
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title, brief = EXCLUDED.brief, pinned_tier = EXCLUDED.pinned_tier,
      pinned_mode = EXCLUDED.pinned_mode, archived = EXCLUDED.archived, updated_at = now()
  `;
}

/** Insert at the local index; on a seq race, land after whatever got there first. */
async function insertMessageRow(conversationId: string, m: Message, seq: number): Promise<void> {
  const q = sql();
  try {
    await q`
      INSERT INTO messages (id, conversation_id, seq, role, content, routing)
      VALUES (${m.id}, ${conversationId}, ${seq}, ${m.role}, ${m.content},
              ${JSON.stringify(m.routing ?? null)}::jsonb)
      ON CONFLICT (id) DO NOTHING
    `;
  } catch {
    const rows = (await q`
      SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM messages WHERE conversation_id = ${conversationId}
    `) as unknown as { next: number }[];
    await q`
      INSERT INTO messages (id, conversation_id, seq, role, content, routing)
      VALUES (${m.id}, ${conversationId}, ${rows[0]?.next ?? seq + 100}, ${m.role}, ${m.content},
              ${JSON.stringify(m.routing ?? null)}::jsonb)
      ON CONFLICT (id) DO NOTHING
    `;
  }
}

async function seedDb(): Promise<void> {
  const seeded = buildSeedState();
  // Parents before children so the FK holds: root first, then by depth.
  const ordered = [...seeded.conversations].sort((a, b) => depthIn(seeded.conversations, a) - depthIn(seeded.conversations, b));
  for (const c of ordered) {
    await upsertConversationRow(c, c.id === seeded.rootId);
    for (const [i, m] of c.messages.entries()) await insertMessageRow(c.id, m, i);
    for (const ins of c.insights) await insertInsightRow(ins);
  }
  const q = sql();
  for (const log of seeded.logs) {
    await q`INSERT INTO inference_logs (id, branch_id, payload) VALUES (${log.id}, ${log.branchId}, ${JSON.stringify(log)}::jsonb) ON CONFLICT (id) DO NOTHING`;
  }
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

async function insertInsightRow(i: Insight): Promise<void> {
  const q = sql();
  await q`
    INSERT INTO insights (id, branch_id, parent_id, text)
    VALUES (${i.id}, ${i.branchId}, ${i.parentId}, ${i.text})
    ON CONFLICT (id) DO NOTHING
  `;
}

/* ---------- public API ---------- */

export async function loadWorkingSet(opts?: { withLogs?: boolean }): Promise<WorkingSet> {
  const withLogs = opts?.withLogs ?? false;
  if (dbEnabled()) {
    try {
      const ws = await loadFromDb(withLogs);
      if (ws) return ws;
    } catch (err) {
      console.warn(`[store] db load failed (${(err as Error).message}) — memory working set`);
    }
  }
  const mem = memoryState();
  return {
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
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
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

/** Flush local mutations. 'failed' means a configured database did not take the writes. */
export async function commit(ws: WorkingSet): Promise<CommitOutcome> {
  if (!dbEnabled()) return 'memory';
  try {
    const q = sql();
    for (const id of ws.dirty) {
      const c = ws.byId.get(id);
      if (!c) continue;
      await upsertConversationRow(c, id === ws.rootId);
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
      await q`INSERT INTO inference_logs (id, branch_id, payload) VALUES (${log.id}, ${log.branchId}, ${JSON.stringify(log)}::jsonb) ON CONFLICT (id) DO NOTHING`;
    }
    ws.dirty.clear();
    ws.newLogs = [];
    return 'persisted';
  } catch (err) {
    console.warn(`[store] commit failed (${(err as Error).message}) — writes not persisted`);
    return 'failed';
  }
}

/** Back to the opening state: truncate (db) or rebuild (memory), then reseed. */
export async function resetStore(): Promise<StateResponse> {
  if (dbEnabled()) {
    try {
      const q = sql();
      await q`TRUNCATE conversations, messages, insights, inference_logs`;
      await seedDb();
    } catch (err) {
      console.warn(`[store] reset failed (${(err as Error).message})`);
    }
  }
  resetMemory();
  const ws = await loadWorkingSet();
  return { rootId: ws.rootId, tree: buildTree(ws), conversations: listConversations(ws) };
}

/* ---------- derived ---------- */

export function availableTokensFor(ws: WorkingSet, parentId: string | null): number {
  return availableTokensForIn(parentId, (id) => ws.byId.get(id));
}

export function buildTree(ws: WorkingSet): BranchNode[] {
  return buildTreeOf(listConversations(ws));
}

export { prunedPct };
