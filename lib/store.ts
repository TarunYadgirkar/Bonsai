import seed from '@/fixtures/seed-conversation.json';
import tree from '@/fixtures/seed-tree.json';
import { assembleVisibleContext } from './context';
import { kvEnabled, kvGet, kvSet } from './kv';
import { appendInferenceLogs } from './inference-log';
import { estimateTokens, messagesTokens, prunedPct } from './tokens';
import type {
  AssembledContext,
  BranchNode,
  Conversation,
  ContextBrief,
  InferenceLog,
  Insight,
  Message,
  SeedConversation,
  StateResponse,
  Tier,
} from './types';

/**
 * In-memory store, seeded from the fixture, optionally mirrored to Upstash.
 *
 * globalThis alone survives Next's dev hot-reload but NOT a Vercel cold start or a second
 * serverless instance — a branch created on stage would vanish on the next request. With KV env
 * vars present, `loadStore()` re-reads the snapshot on every request and `saveStore()` writes it
 * back, so globalThis degrades to a per-request cache and any instance sees the same tree.
 * Without them the behavior is unchanged.
 */
interface StoreShape {
  conversations: Map<string, Conversation>;
  logs: InferenceLog[];
  rootId: string;
  seq: number;
}

type LegacyContextBrief = Omit<ContextBrief, 'sourceRefs' | 'factSourceIds'> &
  Partial<Pick<ContextBrief, 'sourceRefs' | 'factSourceIds'>>;

type LegacyInsight = Omit<Insight, 'sourceMessageIds' | 'active'> &
  Partial<Pick<Insight, 'sourceMessageIds' | 'active'>>;

type StoredConversation = Omit<Conversation, 'brief' | 'insights'> & {
  brief?: LegacyContextBrief;
  insights: LegacyInsight[];
};

/** Shape of fixtures/seed-tree.json. Generated, never hand-edited. */
interface SeedTree {
  rootInsights?: LegacyInsight[];
  branches?: StoredConversation[];
  logs?: InferenceLog[];
  seq?: number;
}

interface StoreSnapshot {
  conversations: StoredConversation[];
  logs: InferenceLog[];
  rootId: string;
  seq: number;
}

const GLOBAL_KEY = Symbol.for('bonsai.store');
const KV_KEY = 'bonsai:store:v1';

/** Logs written this request, waiting to be flushed to the local mirror by flushLogs(). */
const pending: InferenceLog[] = [];

function normalizeBrief(brief: LegacyContextBrief): ContextBrief {
  return {
    ...brief,
    sourceRefs: brief.sourceRefs?.map((source) => ({ ...source })) ?? [],
    factSourceIds:
      brief.factSourceIds?.map((sourceIds) => [...sourceIds]) ?? brief.facts.map(() => []),
  };
}

function normalizeInsight(insight: LegacyInsight): Insight {
  return {
    ...insight,
    sourceMessageIds: [...(insight.sourceMessageIds ?? [])],
    active: insight.active ?? true,
  };
}

function normalizeConversation(conversation: StoredConversation): Conversation {
  return {
    ...conversation,
    brief: conversation.brief ? normalizeBrief(conversation.brief) : undefined,
    insights: conversation.insights.map(normalizeInsight),
  };
}

/**
 * Boots the pre-built demo tree: the root transcript from `seed-conversation.json` plus the
 * scenario branches, insights and inference logs frozen in `seed-tree.json` (regenerate with
 * scripts/build-seed-tree.ts). The root's messages live in one file only — the tree fixture
 * carries what the branches added, never a copy of the transcript.
 */
function build(): StoreShape {
  const fixture = structuredClone(seed) as SeedConversation;
  // Clone: an imported JSON module is a live singleton, and `logs` is pushed to in place by
  // logInference. Without this, rehearsal logs stayed in the fixture array for the life of the
  // process and every reset handed them straight back.
  const preloaded = structuredClone(tree) as SeedTree;
  const root: Conversation = {
    id: fixture.id,
    title: fixture.title,
    parentId: null,
    profile: fixture.profile,
    messages: fixture.messages,
    insights: (preloaded.rootInsights ?? []).map(normalizeInsight),
    pinnedTier: null,
    archived: false,
  };
  const branches = (preloaded.branches ?? []).map(normalizeConversation);
  return {
    conversations: new Map([root, ...branches].map((c) => [c.id, c])),
    logs: (preloaded.logs ?? []) as InferenceLog[],
    rootId: root.id,
    seq: preloaded.seq ?? 0,
  };
}

function store(): StoreShape {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: StoreShape };
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = build();
  return g[GLOBAL_KEY];
}

function setStore(next: StoreShape): void {
  (globalThis as typeof globalThis & { [GLOBAL_KEY]?: StoreShape })[GLOBAL_KEY] = next;
}

function toSnapshot(s: StoreShape): StoreSnapshot {
  return {
    conversations: [...s.conversations.values()],
    logs: s.logs,
    rootId: s.rootId,
    seq: s.seq,
  };
}

function fromSnapshot(snapshot: StoreSnapshot): StoreShape {
  const conversations = snapshot.conversations.map(normalizeConversation);
  return {
    conversations: new Map(conversations.map((conversation) => [conversation.id, conversation])),
    logs: snapshot.logs,
    rootId: snapshot.rootId,
    seq: snapshot.seq,
  };
}

/**
 * Call at the top of every route. No-op without KV env vars. Re-reads on every request rather
 * than caching, because a warm instance holding a stale tree is exactly the failure this fixes.
 */
export async function loadStore(): Promise<void> {
  if (!kvEnabled()) return;
  const read = await kvGet(KV_KEY);

  // Only an empty store may be seeded. On a read error, keep memory and write nothing —
  // seeding here would overwrite a live tree with the fixture.
  if (read.status === 'error') return;
  if (read.status === 'miss') {
    await saveStore();
    return;
  }

  try {
    setStore(fromSnapshot(JSON.parse(read.value) as StoreSnapshot));
  } catch {
    console.warn('[store] unreadable KV snapshot — keeping in-memory state');
  }
}

/** Call before responding from any route that mutated state. Awaited: a frozen lambda drops it. */
export async function saveStore(): Promise<void> {
  if (!kvEnabled()) return;
  await kvSet(KV_KEY, JSON.stringify(toSnapshot(store())));
}

/**
 * Back to the opening state: rebuild from the fixtures, then overwrite the snapshot.
 *
 * Order matters. Clearing the snapshot row alone leaves a warm lambda holding the old tree in
 * globalThis, and its next request writes that tree straight back — so the in-memory store is
 * replaced first, then persisted over the top.
 */
export async function resetStore(): Promise<StateResponse> {
  setStore(build());
  pending.length = 0;
  await saveStore();
  return { rootId: rootId(), tree: buildTree(), conversations: listConversations() };
}

export function nextId(prefix: string): string {
  const s = store();
  s.seq += 1;
  return `${prefix}_${s.seq}`;
}

export function rootId(): string {
  return store().rootId;
}

export function getConversation(id: string): Conversation | undefined {
  return store().conversations.get(id);
}

export function visibleContextFor(id: string): AssembledContext | undefined {
  if (!getConversation(id)) return undefined;
  return assembleVisibleContext(id, getConversation);
}

export function listConversations(): Conversation[] {
  return [...store().conversations.values()];
}

export function putConversation(conversation: Conversation): void {
  store().conversations.set(conversation.id, conversation);
}

/** Immutable update — replaces the stored node rather than mutating it. */
export function updateConversation(
  id: string,
  patch: (c: Conversation) => Conversation,
): Conversation | undefined {
  const current = store().conversations.get(id);
  if (!current) return undefined;
  const next = patch(current);
  store().conversations.set(id, next);
  return next;
}

export function appendMessage(id: string, message: Message): Conversation | undefined {
  return updateConversation(id, (c) => ({ ...c, messages: [...c.messages, message] }));
}

export function appendInsight(parentId: string, insight: Insight): Conversation | undefined {
  return updateConversation(parentId, (c) => ({ ...c, insights: [...c.insights, insight] }));
}

export function logInference(log: InferenceLog): InferenceLog {
  store().logs.push(log);
  pending.push(log);
  return log;
}

/**
 * Mirror everything logged during this request into the local JSON file.
 * Awaited by the routes after saveStore: a frozen lambda drops floating promises. Queued per
 * process rather than per store, so a snapshot reload can't resurrect already-written rows.
 */
export async function flushLogs(): Promise<void> {
  if (!pending.length) return;
  const batch = pending.splice(0, pending.length);
  await appendInferenceLogs(batch);
}

export function listLogs(): InferenceLog[] {
  return [...store().logs];
}

/** Full parent history a branch could have inherited — the baseline every saving is measured against. */
export function availableTokensFor(parentId: string | null): number {
  if (!parentId) return 0;
  const parent = getConversation(parentId);
  if (!parent) return 0;
  const profileTokens = parent.profile
    ? messagesTokens([
        {
          id: 'profile',
          role: 'user',
          content: [parent.profile.name, parent.profile.context, ...parent.profile.goals].join(' '),
        },
      ])
    : 0;
  const insightTokens = parent.insights
    .filter((insight) => insight.active !== false)
    .reduce((sum, insight) => sum + estimateTokens(insight.text), 0);
  return (
    messagesTokens(parent.messages) +
    profileTokens +
    insightTokens +
    availableTokensFor(parent.parentId)
  );
}

function lastTier(c: Conversation): Tier | null {
  for (let i = c.messages.length - 1; i >= 0; i -= 1) {
    const routing = c.messages[i].routing;
    if (routing) return routing.tier;
  }
  return null;
}

function depthOf(c: Conversation): number {
  let depth = 0;
  let cursor = c.parentId;
  while (cursor) {
    const parent = getConversation(cursor);
    if (!parent) break;
    depth += 1;
    cursor = parent.parentId;
  }
  return depth;
}

/** Derived projection for the sidebar. Never stored — always recomputed. */
export function buildTree(): BranchNode[] {
  const all = listConversations();
  return all.map((c) => {
    const brief: ContextBrief | undefined = c.brief;
    return {
      id: c.id,
      title: c.title,
      parentId: c.parentId,
      childIds: all.filter((x) => x.parentId === c.id).map((x) => x.id),
      depth: depthOf(c),
      messageCount: c.messages.length,
      pinnedTier: c.pinnedTier,
      archived: c.archived,
      availableTokens: brief ? brief.availableTokens : null,
      inheritedTokens: brief ? brief.briefTokens : null,
      prunedPct: brief ? brief.prunedPct : null,
      lastTier: lastTier(c),
    };
  });
}

export { prunedPct };
