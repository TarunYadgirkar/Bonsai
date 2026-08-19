/**
 * Garden export: the whole session (or one subtree) as portable Markdown or JSON. Pure
 * functions over Conversation[] — the route just picks scope and sets download headers.
 */
import type { Conversation } from './types';

export type ExportScope = { kind: 'garden' } | { kind: 'branch'; id: string };

/** The subtree rooted at `id`, parents before children. Garden scope = every conversation. */
export function scopeConversations(
  conversations: Conversation[],
  scope: ExportScope,
): Conversation[] {
  if (scope.kind === 'garden') return conversations;
  const byParent = new Map<string | null, Conversation[]>();
  for (const c of conversations) {
    const siblings = byParent.get(c.parentId) ?? [];
    siblings.push(c);
    byParent.set(c.parentId, siblings);
  }
  const root = conversations.find((c) => c.id === scope.id);
  if (!root) return [];
  const out: Conversation[] = [];
  const walk = (node: Conversation) => {
    out.push(node);
    for (const child of byParent.get(node.id) ?? []) walk(child);
  };
  walk(root);
  return out;
}

function heading(depth: number): string {
  return '#'.repeat(Math.min(6, depth + 1));
}

function renderConversation(c: Conversation, depth: number): string {
  const lines: string[] = [];
  lines.push(`${heading(depth)} ${c.title}${c.archived ? ' _(archived)_' : ''}`);
  lines.push('');

  if (c.brief) {
    lines.push(
      `> Compiled brief — ${c.brief.briefTokens.toLocaleString()} of ${c.brief.availableTokens.toLocaleString()} tokens kept (${c.brief.prunedPct.toFixed(1)}% pruned)`,
    );
    for (const fact of c.brief.facts) lines.push(`> - ${fact}`);
    lines.push('');
  }

  if (c.insights.length > 0) {
    lines.push('**Learned from branches:**');
    for (const insight of c.insights) lines.push(`- ${insight.text}`);
    lines.push('');
  }

  for (const m of c.messages) {
    const label = m.role === 'user' ? 'You' : 'Bonsai';
    const routing = m.routing
      ? ` _(${m.routing.modelLabel ?? m.routing.model}${m.routing.effort ? ` · ${m.routing.effort}` : ''}${m.routing.escalated ? ' · escalated' : ''})_`
      : '';
    lines.push(`**${label}:**${routing}`);
    lines.push('');
    lines.push(m.content.trim());
    lines.push('');
  }
  return lines.join('\n');
}

export function exportMarkdown(conversations: Conversation[], scope: ExportScope): string {
  const scoped = scopeConversations(conversations, scope);
  if (scoped.length === 0) return '';
  const byId = new Map(scoped.map((c) => [c.id, c]));
  const depthOf = (c: Conversation): number => {
    let depth = 0;
    let cursor = c.parentId;
    while (cursor && byId.has(cursor)) {
      depth += 1;
      cursor = byId.get(cursor)!.parentId;
    }
    return depth;
  };
  const body = scoped.map((c) => renderConversation(c, depthOf(c))).join('\n---\n\n');
  return `${body}\n\n---\n_Exported from Bonsai — tree-structured AI chat._\n`;
}

export function exportJson(conversations: Conversation[], scope: ExportScope): string {
  const scoped = scopeConversations(conversations, scope);
  return JSON.stringify(
    { format: 'bonsai-garden@1', exportedAt: new Date().toISOString(), conversations: scoped },
    null,
    2,
  );
}
