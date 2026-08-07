import seed from '@/fixtures/seed-conversation.json';
import { messagesTokens, prunedPct } from './tokens';
import type {
  BranchNode,
  Conversation,
  ContextBrief,
  InferenceLog,
  Insight,
  Message,
  SeedConversation,
  Tier,
} from './types';

/**
 * In-memory store, seeded from the fixture.
 *
 * Held on globalThis so Next's dev hot-reload doesn't wipe the tree mid-demo. This does NOT
 * survive across serverless instances on Vercel — M3 swaps the backing store for data/*.json
 * per AGENTS.md. Demo on one warm instance until then.
 */
interface StoreShape {
  conversations: Map<string, Conversation>;
  logs: InferenceLog[];
  rootId: string;
  seq: number;
}

const GLOBAL_KEY = Symbol.for('bonsai.store');

function build(): StoreShape {
  const fixture = seed as SeedConversation;
  const root: Conversation = {
    id: fixture.id,
    title: fixture.title,
    parentId: null,
    profile: fixture.profile,
    messages: fixture.messages,
    insights: [],
    pinnedTier: null,
    archived: false,
  };
  return {
    conversations: new Map([[root.id, root]]),
    logs: [],
    rootId: root.id,
    seq: 0,
  };
}

function store(): StoreShape {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: StoreShape };
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = build();
  return g[GLOBAL_KEY];
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
  return log;
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
  return messagesTokens(parent.messages) + profileTokens + availableTokensFor(parent.parentId);
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
