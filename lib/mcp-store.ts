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
const LIST_LIMIT = 500;

const memNodes = new Map<string, McpNode>();
let degraded = false;

export function storeMode(): 'neon' | 'memory' {
  return dbEnabled() && !degraded ? 'neon' : 'memory';
}

async function withFallback<T>(op: string, dbFn: () => Promise<T>, memFn: () => T): Promise<T> {
  if (storeMode() === 'memory') return memFn();
  try {
    return await dbFn();
  } catch (err) {
    console.warn(`[mcp-store] ${op} failed (${(err as Error).message}) — memory fallback`);
    degraded = true;
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

export async function validateKey(key: string): Promise<boolean> {
  if (!key) return false;
  return withFallback(
    'validateKey',
    async () => {
      const rows = await sql()`SELECT key FROM mcp_users WHERE key = ${key}`;
      return rows.length > 0;
    },
    () => key === DEV_KEY,
  );
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
