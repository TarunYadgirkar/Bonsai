import tree from '@/fixtures/seed-tree.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateTokens, messagesTokens } from './tokens';
import type { Conversation, Insight } from './types';

const kvMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('./kv', () => ({
  kvEnabled: () => true,
  kvGet: kvMocks.get,
  kvSet: kvMocks.set,
}));

import {
  availableTokensFor,
  getConversation,
  listConversations,
  loadStore,
  putConversation,
  resetStore,
  visibleContextFor,
} from './store';

function insight(id: string, text: string, active: boolean): Insight {
  return {
    id,
    branchId: 'child',
    parentId: 'token-parent',
    text,
    createdAt: '2026-08-11T00:00:00.000Z',
    sourceMessageIds: [],
    active,
  };
}

describe('store context compatibility', () => {
  beforeEach(() => {
    kvMocks.get.mockReset();
    kvMocks.set.mockReset();
  });

  it('normalizes legacy fixture briefs without mutating imported JSON', async () => {
    const importedFixture = structuredClone(tree);

    await resetStore();

    const branch = listConversations().find((conversation) => conversation.brief);
    expect(branch?.brief?.sourceRefs).toEqual([]);
    expect(branch?.brief?.factSourceIds).toEqual(branch?.brief?.facts.map(() => []));
    expect(tree).toEqual(importedFixture);
  });

  it('normalizes legacy briefs and insights loaded from a snapshot', async () => {
    kvMocks.get.mockResolvedValueOnce({
      status: 'hit',
      value: JSON.stringify({
        conversations: [
          {
            id: 'legacy-root',
            title: 'Legacy root',
            parentId: null,
            messages: [],
            insights: [
              {
                id: 'legacy-insight',
                branchId: 'legacy-child',
                parentId: 'legacy-root',
                text: 'legacy insight',
                createdAt: '2026-08-11T00:00:00.000Z',
              },
            ],
            pinnedTier: null,
            archived: false,
          },
          {
            id: 'legacy-child',
            title: 'Legacy child',
            parentId: 'legacy-root',
            messages: [],
            brief: {
              id: 'legacy-brief',
              branchId: 'legacy-child',
              selection: 'legacy',
              markdown: '# Legacy brief',
              facts: ['first fact', 'second fact'],
              excludedNote: 'Excluded: nothing.',
              availableTokens: 20,
              briefTokens: 5,
              prunedPct: 75,
            },
            insights: [],
            pinnedTier: null,
            archived: false,
          },
        ],
        logs: [],
        rootId: 'legacy-root',
        seq: 0,
      }),
    });

    await loadStore();

    expect(getConversation('legacy-child')?.brief).toMatchObject({
      sourceRefs: [],
      factSourceIds: [[], []],
    });
    expect(getConversation('legacy-root')?.insights[0]).toMatchObject({
      sourceMessageIds: [],
      active: true,
    });
  });

  it('counts active insight text and excludes inactive insight text', () => {
    const parent: Conversation = {
      id: 'token-parent',
      title: 'Token parent',
      parentId: null,
      messages: [{ id: 'turn', role: 'user', content: 'parent message' }],
      insights: [
        insight('active-insight', 'active context', true),
        insight('inactive-insight', 'inactive context should not count', false),
        {
          id: 'legacy-insight',
          branchId: 'child',
          parentId: 'token-parent',
          text: 'legacy context',
          createdAt: '2026-08-11T00:00:00.000Z',
          sourceMessageIds: [],
          active: true,
        },
      ],
      pinnedTier: null,
      archived: false,
    };
    putConversation(parent);

    expect(availableTokensFor(parent.id)).toBe(
      messagesTokens(parent.messages) +
        estimateTokens('active context') +
        estimateTokens('legacy context'),
    );
  });

  it('returns undefined for unknown visible context IDs', () => {
    expect(visibleContextFor('missing-conversation')).toBeUndefined();
  });
});
