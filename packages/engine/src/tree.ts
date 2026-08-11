/**
 * Pure tree computations over a set of Conversations. No storage, no globals — callers own
 * persistence and pass state in.
 */
import { messagesTokens } from './tokens';
import type { BranchNode, Conversation, ContextBrief, Tier } from './types';

export type ConversationLookup = (id: string) => Conversation | undefined;

/**
 * Full parent history a branch could have inherited — the baseline every saving is measured
 * against. When the fork is anchored, only the immediate parent's messages UP TO the anchor were
 * in scope at fork time; counting the ones after it would inflate the baseline and thus prunedPct.
 * Ancestors are always counted whole (their briefs already captured them).
 */
export function availableTokensFor(
  parentId: string | null,
  byId: ConversationLookup,
  anchorMessageId?: string,
): number {
  if (!parentId) return 0;
  const parent = byId(parentId);
  if (!parent) return 0;
  const scoped = anchorScopedMessages(parent.messages, anchorMessageId);
  const profileTokens = parent.profile
    ? messagesTokens([
        {
          id: 'profile',
          role: 'user',
          content: [parent.profile.name, parent.profile.context, ...parent.profile.goals].join(' '),
        },
      ])
    : 0;
  return messagesTokens(scoped) + profileTokens + availableTokensFor(parent.parentId, byId);
}

/** Same anchor rule as context.ts anchorScoped: unknown anchor scopes to empty, not full. */
function anchorScopedMessages(messages: Conversation['messages'], anchorMessageId?: string) {
  if (!anchorMessageId) return messages;
  const idx = messages.findIndex((m) => m.id === anchorMessageId);
  return idx === -1 ? [] : messages.slice(0, idx + 1);
}

export function lastTier(c: Conversation): Tier | null {
  for (let i = c.messages.length - 1; i >= 0; i -= 1) {
    const routing = c.messages[i].routing;
    if (routing) return routing.tier;
  }
  return null;
}

export function depthOf(c: Conversation, byId: ConversationLookup): number {
  let depth = 0;
  let cursor = c.parentId;
  while (cursor) {
    const parent = byId(cursor);
    if (!parent) break;
    depth += 1;
    cursor = parent.parentId;
  }
  return depth;
}

/** Derived projection for the sidebar. Never stored — always recomputed. */
export function buildTree(all: Conversation[]): BranchNode[] {
  const byIdMap = new Map(all.map((c) => [c.id, c]));
  const byId: ConversationLookup = (id) => byIdMap.get(id);
  const childIds = new Map<string, string[]>();
  for (const c of all) {
    if (!c.parentId) continue;
    const siblings = childIds.get(c.parentId) ?? [];
    siblings.push(c.id);
    childIds.set(c.parentId, siblings);
  }
  return all.map((c) => {
    const brief: ContextBrief | undefined = c.brief;
    return {
      id: c.id,
      title: c.title,
      parentId: c.parentId,
      childIds: childIds.get(c.id) ?? [],
      depth: depthOf(c, byId),
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
