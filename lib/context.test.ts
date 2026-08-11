import { describe, expect, it } from 'vitest';
import { assembleVisibleContext } from './context';
import { estimateTokens } from './tokens';
import type { ContextBrief, Conversation, Insight, Message } from './types';

function conversation(
  id: string,
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id,
    title: id,
    parentId: null,
    messages: [],
    insights: [],
    pinnedTier: null,
    archived: false,
    ...overrides,
  };
}

function message(id: string, content: string): Message {
  return { id, role: 'user', content };
}

function insight(id: string, text: string, active = true): Insight {
  return {
    id,
    branchId: 'child',
    parentId: 'root',
    text,
    createdAt: '2026-08-11T00:00:00.000Z',
    sourceMessageIds: [],
    active,
  };
}

function brief(id: string, markdown: string): ContextBrief {
  return {
    id,
    branchId: 'parent',
    selection: 'topic',
    markdown,
    facts: ['root fact'],
    excludedNote: 'Excluded: unrelated details.',
    availableTokens: 100,
    briefTokens: 10,
    prunedPct: 90,
    sourceRefs: [],
    factSourceIds: [[]],
  };
}

describe('assembleVisibleContext', () => {
  it('assembles a root from profile, messages, then active insights', () => {
    const root = conversation('root', {
      profile: {
        name: 'Tarun',
        context: 'Building Bonsai.',
        goals: ['Ship a reliable context engine.'],
      },
      messages: [message('m1', 'What context is visible?')],
      insights: [insight('i1', 'Only active insights are visible.')],
    });

    const result = assembleVisibleContext('root', (id) =>
      id === root.id ? root : undefined,
    );

    expect(result.sources.map((source) => source.sourceId)).toEqual([
      'profile:root',
      'm1',
      'i1',
    ]);
    expect(result.markdown).toContain('[source:profile:profile:root]');
    expect(result.markdown).toContain('[source:message:m1]');
    expect(result.markdown).toContain('[source:insight:i1]');
    expect(result.tokens).toBe(estimateTokens(result.markdown));
  });

  it('assembles a branch from its immutable brief, own messages, and active insights', () => {
    const originalBriefMarkdown = '# Root facts\n\n- The root established a constraint.';
    const root = conversation('root', {
      messages: [message('root-turn', 'This ancestor turn must not be traversed.')],
    });
    const parent = conversation('parent', {
      parentId: root.id,
      brief: brief('brief-parent', originalBriefMarkdown),
      messages: [message('parent-turn', 'A message on this branch.')],
      insights: [
        insight('parent-insight', 'An active conclusion.'),
        insight('revoked-insight', 'revoked conclusion', false),
      ],
    });
    const conversations = new Map([
      [root.id, root],
      [parent.id, parent],
    ]);

    const result = assembleVisibleContext('parent', (id) => conversations.get(id));

    expect(result.sources.map((source) => source.sourceId)).toEqual([
      'brief-parent',
      'parent-turn',
      'parent-insight',
    ]);
    expect(result.markdown).not.toContain('revoked');
    expect(result.markdown).not.toContain('ancestor turn');
    expect(parent.brief?.markdown).toBe(originalBriefMarkdown);
  });

  it('treats a legacy insight without an active flag as active', () => {
    const legacyInsight = {
      id: 'legacy-insight',
      branchId: 'child',
      parentId: 'root',
      text: 'Legacy context remains visible.',
      createdAt: '2026-08-11T00:00:00.000Z',
    } as Insight;
    const root = conversation('root', { insights: [legacyInsight] });

    const result = assembleVisibleContext('root', (id) =>
      id === root.id ? root : undefined,
    );

    expect(result.sources.map((source) => source.sourceId)).toEqual(['legacy-insight']);
  });

  it('throws an error naming an unknown conversation', () => {
    expect(() => assembleVisibleContext('missing-branch', () => undefined)).toThrow(
      'missing-branch',
    );
  });
});
