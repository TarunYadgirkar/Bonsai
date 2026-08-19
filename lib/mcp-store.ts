/**
 * Neon-backed store for the remote MCP connector. Reads and writes degrade to a
 * per-process memory map when DATABASE_URL is unset or a query fails, so the
 * connector stays usable (with honest "memory only" labeling) without a database.
 */
import { dbEnabled, sql } from '@/lib/db';

export type McpNodeStatus = 'open' | 'merged' | 'abandoned';

export interface McpNode {
  id: string;
  userKey: string;
  parentId: string | null;
  title: string | null;
  question: string | null;
  brief: string | null;
  facts: string[] | null;
  excludedNote: string | null;
  model: string | null;
  effort: string | null;
  tier: string | null;
  availableTokens: number | null;
  briefTokens: number | null;
  prunedPct: number | null;
  status: McpNodeStatus;
  insight: string | null;
  createdAt: string;
}

export interface CreateNodeInput {
  userKey: string;
  parentId: string | null;
  title: string;
  question: string;
  brief: string;
  facts: string[] | null;
  excludedNote: string | null;
  model: string;
  effort: string;
  tier: string;
  availableTokens: number | null;
  briefTokens: number;
  prunedPct: number | null;
}

export interface TreeTotals {
  branches: number;
  open: number;
  merged: number;
  abandoned: number;
  availableTokens: number;
  briefTokens: number;
  prunedPct: number | null;
}

const DEV_KEY = 'bonsai-dev-key';
/** Per-key cap so one garden key can't grow Neon without bound. */
const MAX_NODES_PER_KEY = 500;
/** Above the cap (+ the root) so a within-cap garden is always returned whole, never truncated. */
const LIST_LIMIT = MAX_NODES_PER_KEY + 8;
/** After a DB error, fall back to memory only briefly, then retry Neon — never permanently. */
const DEGRADE_COOLDOWN_MS = 30_000;

const memNodes = new Map<string, McpNode>();
/** Epoch ms until which the database is treated as degraded. 0 = healthy. Not a sticky boolean. */
let degradedUntil = 0;

function dbHealthy(): boolean {
  return dbEnabled() && Date.now() >= degradedUntil;
}

export function storeMode(): 'neon' | 'memory' {
  return dbHealthy() ? 'neon' : 'memory';
}

async function withFallback<T>(op: string, dbFn: () => Promise<T>, memFn: () => T): Promise<T> {
  if (!dbHealthy()) return memFn();
  try {
    return await dbFn();
  } catch (err) {
    console.warn(`[mcp-store] ${op} failed (${(err as Error).message}) — memory fallback`);
    degradedUntil = Date.now() + DEGRADE_COOLDOWN_MS;
    return memFn();
  }
}

function rowToNode(row: Record<string, unknown>): McpNode {
  return {
    id: row.id as string,
    userKey: row.user_key as string,
    parentId: (row.parent_id as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    question: (row.question as string | null) ?? null,
    brief: (row.brief as string | null) ?? null,
    facts: (row.facts as string[] | null) ?? null,
    excludedNote: (row.excluded_note as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    effort: (row.effort as string | null) ?? null,
    tier: (row.tier as string | null) ?? null,
    availableTokens: (row.available_tokens as number | null) ?? null,
    briefTokens: (row.brief_tokens as number | null) ?? null,
    prunedPct: (row.pruned_pct as number | null) ?? null,
    status: row.status as McpNodeStatus,
    insight: (row.insight as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

/**
 * Self-serve garden keys: one per web session, minted from /connect. The session id rides in
 * `label` (schema untouched), so re-clicking returns the same key instead of minting piles of
 * rows. Memory mode (no DATABASE_URL) hands back the dev key — the connector accepts only that
 * key there anyway, and the whole flow stays honest for local demos.
 */
export async function issueKeyForSession(sessionId: string): Promise<string> {
  if (!dbEnabled()) return DEV_KEY;
  const label = `web:${sessionId}`;
  const existing = await sql()`SELECT key FROM mcp_users WHERE label = ${label} LIMIT 1`;
  if (existing.length > 0) return existing[0].key as string;
  const key = `bk_${crypto.randomUUID().replace(/-/g, '')}`;
  await sql()`INSERT INTO mcp_users (key, label) VALUES (${key}, ${label})`;
  return key;
}

export async function validateKey(key: string): Promise<boolean> {
  if (!key) return false;
  if (dbEnabled()) {
    // Production auth must be a real row AND must fail CLOSED. The literal dev key is never valid
    // when a database is configured (even if a stale seed row exists), and a DB error rejects
    // rather than silently falling back to accepting the publicly-known dev key.
    if (key === DEV_KEY) return false;
    try {
      const rows = await sql()`SELECT 1 FROM mcp_users WHERE key = ${key}`;
      return rows.length > 0;
    } catch (err) {
      console.warn(`[mcp-store] validateKey failed (${(err as Error).message}) — rejecting`);
      return false;
    }
  }
  // Keyless local dev: the dev key is the only accepted key.
  return key === DEV_KEY;
}

function rootNode(userKey: string): McpNode {
  return {
    id: `root-${userKey}`,
    userKey,
    parentId: null,
    title: 'session',
    question: null,
    brief: null,
    facts: null,
    excludedNote: null,
    model: null,
    effort: null,
    tier: null,
    availableTokens: null,
    briefTokens: null,
    prunedPct: null,
    status: 'open',
    insight: null,
    createdAt: new Date().toISOString(),
  };
}

async function ensureRoot(userKey: string): Promise<string> {
  const root = rootNode(userKey);
  return withFallback(
    'ensureRoot',
    async () => {
      await sql()`
        INSERT INTO mcp_nodes (id, user_key, title, status, created_at)
        VALUES (${root.id}, ${userKey}, ${root.title}, 'open', ${root.createdAt})
        ON CONFLICT (id) DO NOTHING`;
      return root.id;
    },
    () => {
      if (!memNodes.has(root.id)) memNodes.set(root.id, root);
      return root.id;
    },
  );
}

export async function createNode(input: CreateNodeInput): Promise<McpNode> {
  const parentId = input.parentId ?? (await ensureRoot(input.userKey));
  const node: McpNode = {
    id: crypto.randomUUID(),
    userKey: input.userKey,
    parentId,
    title: input.title,
    question: input.question,
    brief: input.brief,
    facts: input.facts,
    excludedNote: input.excludedNote,
    model: input.model,
    effort: input.effort,
    tier: input.tier,
    availableTokens: input.availableTokens,
    briefTokens: input.briefTokens,
    prunedPct: input.prunedPct,
    status: 'open',
    insight: null,
    createdAt: new Date().toISOString(),
  };
  return withFallback(
    'createNode',
    async () => {
      await sql()`
        INSERT INTO mcp_nodes
          (id, user_key, parent_id, title, question, brief, facts, excluded_note,
           model, effort, tier, available_tokens, brief_tokens, pruned_pct, status, created_at)
        VALUES
          (${node.id}, ${node.userKey}, ${node.parentId}, ${node.title}, ${node.question},
           ${node.brief}, ${JSON.stringify(node.facts ?? null)}::jsonb, ${node.excludedNote},
           ${node.model}, ${node.effort}, ${node.tier}, ${node.availableTokens},
           ${node.briefTokens}, ${node.prunedPct}, ${node.status}, ${node.createdAt})`;
      return node;
    },
    () => {
      memNodes.set(node.id, node);
      return node;
    },
  );
}

function memUpdate(nodeId: string, key: string, patch: Partial<McpNode>): McpNode | null {
  const current = memNodes.get(nodeId);
  if (!current || current.userKey !== key) return null;
  const next = { ...current, ...patch };
  memNodes.set(nodeId, next);
  return next;
}

export async function setInsight(nodeId: string, insight: string, key: string): Promise<McpNode | null> {
  return withFallback(
    'setInsight',
    async () => {
      const rows = await sql()`
        UPDATE mcp_nodes SET insight = ${insight}, status = 'merged'
        WHERE id = ${nodeId} AND user_key = ${key}
        RETURNING *`;
      return rows.length > 0 ? rowToNode(rows[0]) : null;
    },
    () => memUpdate(nodeId, key, { insight, status: 'merged' }),
  );
}

export async function abandonNode(nodeId: string, key: string): Promise<McpNode | null> {
  return withFallback(
    'abandonNode',
    async () => {
      const rows = await sql()`
        UPDATE mcp_nodes SET status = 'abandoned'
        WHERE id = ${nodeId} AND user_key = ${key}
        RETURNING *`;
      return rows.length > 0 ? rowToNode(rows[0]) : null;
    },
    () => memUpdate(nodeId, key, { status: 'abandoned' }),
  );
}

export { MAX_NODES_PER_KEY };

export async function countNodes(key: string): Promise<number> {
  return withFallback(
    'countNodes',
    async () => {
      const rows = (await sql()`
        SELECT count(*)::int AS n FROM mcp_nodes WHERE user_key = ${key}
      `) as unknown as { n: number }[];
      return rows[0]?.n ?? 0;
    },
    () => [...memNodes.values()].filter((n) => n.userKey === key).length,
  );
}

export async function nodeExists(key: string, id: string): Promise<boolean> {
  return withFallback(
    'nodeExists',
    async () => {
      const rows = await sql()`SELECT 1 FROM mcp_nodes WHERE id = ${id} AND user_key = ${key}`;
      return rows.length > 0;
    },
    () => {
      const node = memNodes.get(id);
      return Boolean(node && node.userKey === key);
    },
  );
}

/** Key-scoped point lookup — fork's parent check needs one row, not a listNodes() sweep. */
export async function getNode(key: string, id: string): Promise<McpNode | null> {
  return withFallback(
    'getNode',
    async () => {
      const rows = await sql()`SELECT * FROM mcp_nodes WHERE id = ${id} AND user_key = ${key}`;
      return rows.length > 0 ? rowToNode(rows[0]) : null;
    },
    () => {
      const node = memNodes.get(id);
      return node && node.userKey === key ? node : null;
    },
  );
}

export async function listNodes(key: string): Promise<McpNode[]> {
  return withFallback(
    'listNodes',
    async () => {
      const rows = await sql()`
        SELECT * FROM mcp_nodes WHERE user_key = ${key}
        ORDER BY created_at, id LIMIT ${LIST_LIMIT}`;
      return rows.map(rowToNode);
    },
    () =>
      [...memNodes.values()]
        .filter((n) => n.userKey === key)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .slice(0, LIST_LIMIT),
  );
}

export function summarize(nodes: McpNode[]): TreeTotals {
  const branches = nodes.filter((n) => n.parentId !== null);
  const availableTokens = branches.reduce((sum, n) => sum + (n.availableTokens ?? 0), 0);
  const briefTokens = branches.reduce((sum, n) => sum + (n.briefTokens ?? 0), 0);
  return {
    branches: branches.length,
    open: branches.filter((n) => n.status === 'open').length,
    merged: branches.filter((n) => n.status === 'merged').length,
    abandoned: branches.filter((n) => n.status === 'abandoned').length,
    availableTokens,
    briefTokens,
    prunedPct:
      availableTokens > 0
        ? Math.max(0, Math.round((1 - briefTokens / availableTokens) * 1000) / 10)
        : null,
  };
}

export async function treeSummary(key: string): Promise<TreeTotals> {
  return summarize(await listNodes(key));
}
