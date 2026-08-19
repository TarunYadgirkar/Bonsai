import { describe, expect, it } from 'vitest';
import { exportJson, exportMarkdown, scopeConversations } from '../lib/export';
import type { Conversation } from '../lib/types';

function conv(partial: Partial<Conversation> & { id: string; title: string }): Conversation {
  return {
    parentId: null,
    messages: [],
    insights: [],
    pinnedTier: null,
    archived: false,
    ...partial,
  } as Conversation;
}

const garden: Conversation[] = [
  conv({
    id: 'root',
    title: 'Trunk',
    messages: [
      { id: 'm1', role: 'user', content: 'Question?' },
      { id: 'm2', role: 'assistant', content: 'Answer.' },
    ],
    insights: [
      { id: 'i1', branchId: 'b1', parentId: 'root', text: 'One line.', createdAt: '2026-08-18T00:00:00Z' },
    ],
  }),
  conv({ id: 'b1', title: 'Side question', parentId: 'root', archived: true }),
  conv({ id: 'b2', title: 'Deeper', parentId: 'b1' }),
  conv({ id: 'other', title: 'Second tree' }),
];

describe('scopeConversations', () => {
  it('branch scope walks the subtree, parents first', () => {
    expect(scopeConversations(garden, { kind: 'branch', id: 'b1' }).map((c) => c.id)).toEqual([
      'b1',
      'b2',
    ]);
    expect(scopeConversations(garden, { kind: 'branch', id: 'nope' })).toEqual([]);
  });
});

describe('exportMarkdown', () => {
  it('renders headings by depth, insights, roles, and the archived marker', () => {
    const md = exportMarkdown(garden, { kind: 'garden' });
    expect(md).toContain('# Trunk');
    expect(md).toContain('## Side question _(archived)_');
    expect(md).toContain('### Deeper');
    expect(md).toContain('# Second tree');
    expect(md).toContain('**Learned from branches:**\n- One line.');
    expect(md).toContain('**You:**\n\nQuestion?');
    expect(md).toContain('**Bonsai:**\n\nAnswer.');
  });

  it('branch scope re-roots the heading depth at the subtree', () => {
    const md = exportMarkdown(garden, { kind: 'branch', id: 'b1' });
    expect(md).toContain('# Side question');
    expect(md).toContain('## Deeper');
    expect(md).not.toContain('Trunk');
  });
});

describe('exportJson', () => {
  it('is versioned and round-trips the scoped conversations', () => {
    const parsed = JSON.parse(exportJson(garden, { kind: 'branch', id: 'b1' }));
    expect(parsed.format).toBe('bonsai-garden@1');
    expect(parsed.conversations.map((c: Conversation) => c.id)).toEqual(['b1', 'b2']);
  });
});
