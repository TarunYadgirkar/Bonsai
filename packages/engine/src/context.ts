/**
 * Context assembly — the part of Bonsai that is the product.
 *
 * Briefs compose recursively: a branch's brief already distilled everything above it, so the
 * compile input for a new fork is the parent's brief + the parent's merged insights + the
 * parent's own transcript up to the fork anchor. Referents resolved at depth N stay resolved at
 * depth N+1 because the resolution travels inside the brief. The full ancestor transcript is
 * deliberately NOT re-walked — that is the pruning bet, and `widen` is the escape hatch.
 */
import { logger } from './logger';
import { estimateTokens, messagesTokens } from './tokens';
import type { Conversation, Message, UserProfile } from './types';
import type { ConversationLookup } from './tree';

/** Turns of parent transcript pulled in when a brief proves too small. */
const WIDEN_TURNS = 12;

export interface AssembledPath {
  /** Rendered compile input: brief-of-parent, insights, anchored transcript. */
  markdown: string;
  tokens: number;
  /** Parent messages actually in scope (anchor-truncated), for downstream widen decisions. */
  scopedMessages: Message[];
  /**
   * The inherited brief's top fact — the chain's anchor. Pass to compileBrief so the entity
   * grounding the whole branch chain survives every composition (without it, a deep fork whose
   * question never names the entity can compile to "It closes September 11" — dangling referent).
   */
  anchorFact?: string;
  /** The inherited brief's full fact list, verbatim — so the compiler composes and pins them
   *  rather than re-summarizing (paraphrase is where resolved referents and identifiers die). */
  inheritedFacts?: string[];
}

/** Nearest ancestor profile — only the root carries one, but any node may be forked. */
export function profileFor(
  conversation: Conversation,
  byId: ConversationLookup,
): UserProfile | undefined {
  let cursor: Conversation | undefined = conversation;
  while (cursor) {
    if (cursor.profile) return cursor.profile;
    cursor = cursor.parentId ? byId(cursor.parentId) : undefined;
  }
  return undefined;
}

/**
 * Everything the compiler may read when forking off `parent`. Anchoring: messages after
 * `anchorMessageId` had not happened yet from the fork's point of view and are excluded.
 */
export function assemblePath(params: {
  parent: Conversation;
  byId: ConversationLookup;
  anchorMessageId?: string;
}): AssembledPath {
  const { parent, anchorMessageId } = params;
  const scopedMessages = anchorScoped(parent.messages, anchorMessageId);

  const sections: string[] = [];
  if (parent.brief) {
    sections.push(`## Inherited context (compiled when this conversation was forked)\n${parent.brief.markdown}`);
  }
  if (parent.insights.length) {
    sections.push(renderInsights(parent));
  }
  sections.push(`## Conversation\n${renderTurns(scopedMessages)}`);

  const markdown = sections.join('\n\n');
  const anchorFact = parent.brief?.facts[0];
  return {
    markdown,
    tokens: estimateTokens(markdown),
    ...(parent.brief?.facts.length ? { inheritedFacts: parent.brief.facts } : {}),
    scopedMessages,
    ...(anchorFact ? { anchorFact } : {}),
  };
}

/**
 * What a model sees when answering inside a conversation: the brief it inherited, what its
 * branches merged back, and its own turns. Roots have no brief and carry full transcript.
 */
export function renderChatContext(conversation: Conversation): {
  context: string;
  contextTokens: number;
} {
  const sections: string[] = [];
  if (conversation.brief) sections.push(conversation.brief.markdown);
  if (conversation.insights.length) sections.push(renderInsights(conversation));
  sections.push(
    conversation.brief
      ? `## This branch so far\n${renderTurns(conversation.messages)}`
      : renderTurns(conversation.messages),
  );
  const context = sections.join('\n\n');
  return { context, contextTokens: estimateTokens(context) };
}

/**
 * The context lever the escalation ladder pulls before spending on a bigger model: pull recent
 * in-scope parent turns in beside the brief. Returns null when there is nothing to widen with —
 * roots already carry everything, and a parentless brief cannot reach back.
 */
export function widenedChatContext(
  conversation: Conversation,
  byId: ConversationLookup,
): { context: string; addedTokens: number } | null {
  if (!conversation.brief || !conversation.parentId) return null;
  const parent = byId(conversation.parentId);
  if (!parent || !parent.messages.length) return null;

  const scoped = anchorScoped(parent.messages, conversation.brief.anchorMessageId);
  const window = scoped.slice(-WIDEN_TURNS);
  if (!window.length) return null;

  const base = renderChatContext(conversation);
  const extra = `## Pulled from the parent thread (brief was insufficient)\n${renderTurns(window)}`;
  return {
    context: `${base.context}\n\n${extra}`,
    addedTokens: messagesTokens(window),
  };
}

function anchorScoped(messages: Message[], anchorMessageId?: string): Message[] {
  if (!anchorMessageId) return messages;
  const idx = messages.findIndex((m) => m.id === anchorMessageId);
  if (idx !== -1) return messages.slice(0, idx + 1);
  // Anchor specified but not found: the scope boundary is unknown, so fail CLOSED (send nothing
  // after it) rather than silently leaking the whole transcript past the intended cut point.
  logger.warn(`[context] anchor ${anchorMessageId} not found — scoping to empty, not full transcript`);
  return [];
}

function renderInsights(conversation: Conversation): string {
  return `## Learned from branches\n${conversation.insights.map((i) => `- ${i.text}`).join('\n')}`;
}

function renderTurns(messages: Message[]): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
}
