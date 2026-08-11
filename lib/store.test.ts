import tree from '@/fixtures/seed-tree.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  StoreSequenceExhaustedError,
  availableTokensFor,
  getConversation,
  listConversations,
  loadStore,
  nextId,
  putConversation,
  resetStore,
  saveStore,
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('loads generated fixture briefs without mutating imported JSON', async () => {
    const importedFixture = structuredClone(tree);

    await resetStore();

    const branch = listConversations().find((conversation) => conversation.brief);
    const fixtureBranch = tree.branches.find((conversation) => conversation.brief);
    expect(branch?.brief?.sourceRefs).toEqual(fixtureBranch?.brief?.sourceRefs);
    expect(branch?.brief?.factSourceIds).toEqual(fixtureBranch?.brief?.factSourceIds);
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
      factProvenance: ['legacy-unknown', 'legacy-unknown'],
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

  it('round-trips a persisted forest with multiple independent roots', async () => {
    await resetStore();
    const independentRootId = nextId('conv');
    const independentChildId = nextId('branch');
    const independentBriefId = nextId('brief');
    const independentRoot: Conversation = {
      id: independentRootId,
      title: 'Independent root',
      parentId: null,
      messages: [],
      insights: [],
      pinnedTier: null,
      archived: false,
    };
    const independentChild: Conversation = {
      id: independentChildId,
      title: 'Independent child',
      parentId: independentRootId,
      messages: [],
      brief: {
        id: independentBriefId,
        branchId: independentChildId,
        selection: 'Independent topic',
        markdown: '# Independent context',
        facts: ['The independent topic is in focus.'],
        excludedNote: 'Excluded: nothing else was supplied.',
        availableTokens: 0,
        briefTokens: 4,
        prunedPct: 0,
        sourceRefs: [
          {
            kind: 'selection',
            conversationId: independentChildId,
            sourceId: `selection:${independentChildId}`,
          },
        ],
        factSourceIds: [[`selection:${independentChildId}`]],
        factProvenance: ['extractive'],
      },
      insights: [],
      pinnedTier: null,
      archived: false,
    };
    putConversation(independentRoot);
    putConversation(independentChild);
    await saveStore();
    const savedSnapshot = kvMocks.set.mock.calls.at(-1)?.[1] as string | undefined;
    if (!savedSnapshot) throw new Error('missing saved snapshot');

    await resetStore();
    kvMocks.get.mockResolvedValueOnce({ status: 'hit', value: savedSnapshot });
    await loadStore();

    expect(getConversation(independentRootId)).toEqual(independentRoot);
    expect(getConversation(independentChildId)).toEqual(independentChild);
  });

  it('loads a terminal sequence but refuses allocation without mutating it', async () => {
    kvMocks.get.mockResolvedValueOnce({
      status: 'hit',
      value: JSON.stringify({
        conversations: [
          {
            id: 'terminal-root',
            title: 'Terminal root',
            parentId: null,
            messages: [],
            insights: [],
            pinnedTier: null,
            archived: false,
          },
        ],
        logs: [],
        rootId: 'terminal-root',
        seq: Number.MAX_SAFE_INTEGER,
      }),
    });

    await loadStore();

    expect(() => nextId('msg')).toThrow(StoreSequenceExhaustedError);
    expect(() => nextId('msg')).toThrow('store sequence exhausted');
    await saveStore();
    const saved = JSON.parse(kvMocks.set.mock.calls.at(-1)?.[1] as string) as { seq: number };
    expect(saved.seq).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    {
      name: 'nested factSourceIds',
      mutate: (snapshot: Record<string, unknown>) => {
        const conversations = snapshot.conversations as Array<Record<string, unknown>>;
        const brief = conversations[1].brief as Record<string, unknown>;
        brief.factSourceIds = [['root-message', 42]];
      },
    },
    {
      name: 'unknown fact source membership',
      mutate: (snapshot: Record<string, unknown>) => {
        const conversations = snapshot.conversations as Array<Record<string, unknown>>;
        const brief = conversations[1].brief as Record<string, unknown>;
        brief.factSourceIds = [['fabricated-source']];
      },
    },
    {
      name: 'insight active flag',
      mutate: (snapshot: Record<string, unknown>) => {
        const conversations = snapshot.conversations as Array<Record<string, unknown>>;
        const insights = conversations[0].insights as Array<Record<string, unknown>>;
        insights[0].active = 'false';
      },
    },
    {
      name: 'parent cycle',
      mutate: (snapshot: Record<string, unknown>) => {
        const conversations = snapshot.conversations as Array<Record<string, unknown>>;
        conversations[1].parentId = 'invalid-child';
      },
    },
    {
      name: 'orphan parent',
      mutate: (snapshot: Record<string, unknown>) => {
        const conversations = snapshot.conversations as Array<Record<string, unknown>>;
        conversations[1].parentId = 'missing-parent';
      },
    },
    {
      name: 'non-root primary root',
      mutate: (snapshot: Record<string, unknown>) => {
        const conversations = snapshot.conversations as Array<Record<string, unknown>>;
        conversations[0].parentId = 'invalid-child';
        conversations[1].parentId = null;
      },
    },
    {
      name: 'sequence below a generated ID',
      mutate: (snapshot: Record<string, unknown>) => {
        const conversations = snapshot.conversations as Array<Record<string, unknown>>;
        conversations[1].id = 'branch_10';
        snapshot.seq = 9;
      },
    },
  ])('keeps prior memory when a valid JSON snapshot has malformed $name', async ({ mutate }) => {
    await resetStore();
    const sentinel: Conversation = {
      id: 'memory-sentinel',
      title: 'Memory sentinel',
      parentId: null,
      messages: [],
      insights: [],
      pinnedTier: null,
      archived: false,
    };
    putConversation(sentinel);
    const snapshot: Record<string, unknown> = {
      conversations: [
        {
          id: 'invalid-root',
          title: 'Invalid root',
          parentId: null,
          messages: [],
          insights: [
            {
              id: 'root-insight',
              branchId: 'invalid-child',
              parentId: 'invalid-root',
              text: 'Insight text.',
              createdAt: '2026-08-11T00:00:00.000Z',
              sourceMessageIds: [],
              active: true,
            },
          ],
          pinnedTier: null,
          archived: false,
        },
        {
          id: 'invalid-child',
          title: 'Invalid child',
          parentId: 'invalid-root',
          messages: [],
          brief: {
            id: 'invalid-brief',
            branchId: 'invalid-child',
            selection: 'runtime',
            markdown: '# Brief',
            facts: ['Use SQLite.'],
            excludedNote: 'Excluded: nothing.',
            availableTokens: 20,
            briefTokens: 3,
            prunedPct: 85,
            sourceRefs: [
              { kind: 'message', conversationId: 'invalid-root', sourceId: 'root-message' },
            ],
            factSourceIds: [['root-message']],
            factProvenance: ['model-cited'],
          },
          insights: [],
          pinnedTier: null,
          archived: false,
        },
      ],
      logs: [],
      rootId: 'invalid-root',
      seq: 1,
    };
    mutate(snapshot);
    kvMocks.get.mockResolvedValueOnce({ status: 'hit', value: JSON.stringify(snapshot) });

    await loadStore();

    expect(getConversation(sentinel.id)).toEqual(sentinel);
    expect(getConversation('invalid-root')).toBeUndefined();
  });

  it('boots only the root when the supported development fixture flag is set', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BONSAI_ROOT_ONLY_FIXTURE', '1');

    await resetStore();

    expect(listConversations()).toHaveLength(1);
  });

  it('never reads or writes KV while the development root-only fixture flag is active', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BONSAI_ROOT_ONLY_FIXTURE', '1');
    kvMocks.get.mockResolvedValue({ status: 'miss' });

    await resetStore();
    await loadStore();

    expect(kvMocks.get).not.toHaveBeenCalled();
    expect(kvMocks.set).not.toHaveBeenCalled();
  });

  it('ignores the root-only fixture flag in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BONSAI_ROOT_ONLY_FIXTURE', '1');

    await resetStore();

    expect(listConversations().length).toBeGreaterThan(1);
  });
});
