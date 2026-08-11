import { describe, expect, it } from 'vitest';
import { PersistenceSchemaError } from './persistence/errors';
import { parseStoreSnapshot } from './store-schema';

function currentSnapshot(): Record<string, unknown> {
  return {
    conversations: [
      {
        id: 'root-main',
        title: 'Primary root',
        parentId: null,
        messages: [{ id: 'msg_1', role: 'user', content: 'Use a durable local store.' }],
        insights: [
          {
            id: 'insight_5',
            branchId: 'branch_2',
            parentId: 'root-main',
            text: 'Use SQLite.',
            createdAt: '2026-08-11T00:00:00.000Z',
            sourceMessageIds: ['msg_4'],
            active: true,
          },
        ],
        pinnedTier: null,
        archived: false,
      },
      {
        id: 'branch_2',
        title: 'Storage branch',
        parentId: 'root-main',
        messages: [
          {
            id: 'msg_4',
            role: 'assistant',
            content: 'SQLite is a good fit.',
            routing: {
              tier: 'thoughtful',
              model: 'bonsai-balanced',
              modelLabel: 'Balanced',
              label: 'Balanced · Medium effort',
              effort: 'medium',
              servedBy: 'provider-model',
              effortNote: 'medium effort, single pass',
              contextTokens: 12,
              estCostUsd: 0.002,
              reason: 'Architecture decision.',
              complexity: 2,
              escalated: false,
              overridden: false,
            },
          },
        ],
        brief: {
          id: 'brief_3',
          branchId: 'branch_2',
          selection: 'durable local store',
          markdown: '# Context\nUse a durable local store.',
          facts: ['A durable local store is required.'],
          excludedNote: 'Excluded: unrelated discussion.',
          availableTokens: 20,
          briefTokens: 8,
          prunedPct: 60,
          sourceRefs: [
            { kind: 'message', conversationId: 'root-main', sourceId: 'msg_1' },
          ],
          factSourceIds: [['msg_1']],
          factProvenance: ['model-cited'],
        },
        insights: [],
        pinnedTier: 'thoughtful',
        archived: true,
      },
      {
        id: 'independent-root',
        title: 'Independent root',
        parentId: null,
        messages: [],
        insights: [],
        pinnedTier: null,
        archived: false,
      },
      {
        id: 'independent-child',
        title: 'Independent child',
        parentId: 'independent-root',
        messages: [],
        brief: {
          id: 'independent-brief',
          branchId: 'independent-child',
          selection: 'independent topic',
          markdown: '# Independent context',
          facts: ['The independent topic is in focus.'],
          excludedNote: 'Excluded: nothing else was supplied.',
          availableTokens: 0,
          briefTokens: 4,
          prunedPct: 0,
          sourceRefs: [
            {
              kind: 'selection',
              conversationId: 'independent-child',
              sourceId: 'selection:independent-child',
            },
          ],
          factSourceIds: [['selection:independent-child']],
          factProvenance: ['extractive'],
        },
        insights: [],
        pinnedTier: null,
        archived: false,
      },
    ],
    logs: [
      {
        id: 'log_6',
        ts: '2026-08-11T00:00:00.000Z',
        branchId: 'branch_2',
        purpose: 'chat',
        tier: 'thoughtful',
        model: 'bonsai-balanced',
        servedBy: 'provider-model',
        effort: 'medium',
        inputTokens: 12,
        outputTokens: 6,
        estCostUsd: 0.002,
        status: 'succeeded',
        escalated: false,
        overridden: false,
        baselineInputTokens: 20,
        baselineCostUsd: 0.004,
      },
    ],
    rootId: 'root-main',
    seq: 6,
  };
}

function assertRejected(
  name: string,
  mutate: (snapshot: Record<string, unknown>) => void,
): void {
  const snapshot = currentSnapshot();
  mutate(snapshot);
  const before = structuredClone(snapshot);

  expect(() => parseStoreSnapshot(snapshot), name).toThrow(PersistenceSchemaError);
  expect(snapshot).toEqual(before);
}

describe('parseStoreSnapshot', () => {
  it('accepts a current forest with multiple independent roots without mutating it', () => {
    const snapshot = currentSnapshot();
    const before = structuredClone(snapshot);

    const parsed = parseStoreSnapshot(snapshot);

    expect(parsed.rootId).toBe('root-main');
    expect(parsed.conversations.map(({ id }) => id)).toEqual([
      'root-main',
      'branch_2',
      'independent-root',
      'independent-child',
    ]);
    expect(parsed.conversations[1].brief?.factProvenance).toEqual(['model-cited']);
    expect(parsed.logs[0].status).toBe('succeeded');
    expect(parsed).not.toBe(snapshot);
    expect(snapshot).toEqual(before);
  });

  it('normalizes legacy brief, insight, and inference fields without mutating input', () => {
    const snapshot = currentSnapshot();
    const conversations = snapshot.conversations as Array<Record<string, unknown>>;
    const rootInsights = conversations[0].insights as Array<Record<string, unknown>>;
    const brief = conversations[1].brief as Record<string, unknown>;
    const logs = snapshot.logs as Array<Record<string, unknown>>;
    delete rootInsights[0].sourceMessageIds;
    delete rootInsights[0].active;
    delete brief.sourceRefs;
    delete brief.factSourceIds;
    delete brief.factProvenance;
    delete logs[0].status;
    const before = structuredClone(snapshot);

    const parsed = parseStoreSnapshot(snapshot);

    expect(parsed.conversations[0].insights[0]).toMatchObject({
      sourceMessageIds: [],
      active: true,
    });
    expect(parsed.conversations[1].brief).toMatchObject({
      sourceRefs: [],
      factSourceIds: [[]],
      factProvenance: ['legacy-unknown'],
    });
    expect(parsed.logs[0].status).toBe('succeeded');
    expect(snapshot).toEqual(before);
  });

  it('rejects unsafe persisted IDs', () => {
    assertRejected('unsafe ID', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      conversations[2].id = '../escape';
    });
  });

  it('rejects prototype-reserved persisted IDs', () => {
    assertRejected('reserved ID', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      conversations[2].id = 'constructor';
      conversations[3].parentId = 'constructor';
    });
  });

  it('rejects duplicate conversation IDs', () => {
    assertRejected('duplicate conversation', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      conversations[2].id = 'branch_2';
    });
  });

  it('rejects duplicate entity IDs across conversations', () => {
    assertRejected('duplicate entity', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      conversations[3].messages = [{ id: 'msg_1', role: 'user', content: 'Duplicate.' }];
    });
  });

  it('rejects malformed nested routing fields', () => {
    assertRejected('routing', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      const messages = conversations[1].messages as Array<Record<string, unknown>>;
      const routing = messages[0].routing as Record<string, unknown>;
      routing.label = 42;
    });
  });

  it('rejects malformed nested brief provenance', () => {
    assertRejected('provenance', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      const brief = conversations[1].brief as Record<string, unknown>;
      brief.factSourceIds = [['missing-source']];
    });
  });

  it('rejects non-legacy provenance without a cited source', () => {
    assertRejected('uncited provenance', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      const brief = conversations[1].brief as Record<string, unknown>;
      brief.factSourceIds = [[]];
    });
  });

  it('rejects source references that do not identify persisted evidence', () => {
    assertRejected('evidence reference', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      const brief = conversations[1].brief as Record<string, unknown>;
      brief.sourceRefs = [
        { kind: 'message', conversationId: 'root-main', sourceId: 'missing-message' },
      ];
      brief.factSourceIds = [['missing-message']];
    });
  });

  it('rejects ambiguous source IDs within one brief', () => {
    assertRejected('ambiguous source ID', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      conversations[0].profile = { name: 'Tarun', context: 'Builder', goals: [] };
      const messages = conversations[0].messages as Array<Record<string, unknown>>;
      messages.push({
        id: 'profile:root-main',
        role: 'user',
        content: 'A message whose ID collides with the profile source.',
      });
      const brief = conversations[1].brief as Record<string, unknown>;
      brief.sourceRefs = [
        {
          kind: 'profile',
          conversationId: 'root-main',
          sourceId: 'profile:root-main',
        },
        {
          kind: 'message',
          conversationId: 'root-main',
          sourceId: 'profile:root-main',
        },
      ];
      brief.factSourceIds = [['profile:root-main']];
    });
  });

  it.each([
    {
      name: 'an independent root',
      mutate: (snapshot: Record<string, unknown>) => {
        const conversations = snapshot.conversations as Array<Record<string, unknown>>;
        conversations[2].messages = [
          { id: 'independent-message', role: 'user', content: 'Unrelated evidence.' },
        ];
        const brief = conversations[1].brief as Record<string, unknown>;
        brief.sourceRefs = [
          {
            kind: 'message',
            conversationId: 'independent-root',
            sourceId: 'independent-message',
          },
        ];
        brief.factSourceIds = [['independent-message']];
      },
    },
    {
      name: 'a descendant branch',
      mutate: (snapshot: Record<string, unknown>) => {
        const conversations = snapshot.conversations as Array<Record<string, unknown>>;
        conversations.push({
          id: 'branch-descendant',
          title: 'Descendant',
          parentId: 'branch_2',
          messages: [
            { id: 'descendant-message', role: 'user', content: 'Future evidence.' },
          ],
          insights: [],
          pinnedTier: null,
          archived: false,
        });
        const brief = conversations[1].brief as Record<string, unknown>;
        brief.sourceRefs = [
          {
            kind: 'message',
            conversationId: 'branch-descendant',
            sourceId: 'descendant-message',
          },
        ];
        brief.factSourceIds = [['descendant-message']];
      },
    },
  ])('rejects brief evidence from $name', ({ mutate }) => {
    assertRejected('ineligible evidence', mutate);
  });

  it('rejects malformed nested insight lifecycle fields', () => {
    assertRejected('lifecycle', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      const insights = conversations[0].insights as Array<Record<string, unknown>>;
      insights[0].active = 'true';
    });
  });

  it('rejects insight evidence that does not belong to its source branch', () => {
    assertRejected('insight evidence', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      const insights = conversations[0].insights as Array<Record<string, unknown>>;
      insights[0].sourceMessageIds = ['msg_1'];
    });
  });

  it('rejects a brief attached to a different branch', () => {
    assertRejected('brief branch', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      const brief = conversations[1].brief as Record<string, unknown>;
      brief.branchId = 'independent-child';
    });
  });

  it('rejects a root conversation with a brief', () => {
    assertRejected('root brief', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      conversations[0].brief = {
        id: 'root-brief',
        branchId: 'root-main',
        selection: 'invalid root brief',
        markdown: '# Invalid root brief',
        facts: ['Invalid.'],
        excludedNote: 'Excluded: nothing.',
        availableTokens: 0,
        briefTokens: 2,
        prunedPct: 0,
        sourceRefs: [
          {
            kind: 'selection',
            conversationId: 'root-main',
            sourceId: 'selection:root-main',
          },
        ],
        factSourceIds: [['selection:root-main']],
        factProvenance: ['extractive'],
      };
    });
  });

  it('rejects a non-root conversation without a brief', () => {
    assertRejected('missing branch brief', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      delete conversations[1].brief;
    });
  });

  it('rejects orphan parents', () => {
    assertRejected('orphan', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      conversations[1].parentId = 'missing-parent';
    });
  });

  it('rejects cycles in an independent tree', () => {
    assertRejected('cycle', (snapshot) => {
      const conversations = snapshot.conversations as Array<Record<string, unknown>>;
      conversations[2].parentId = 'independent-child';
    });
  });

  it('rejects a non-root primary root', () => {
    assertRejected('primary root', (snapshot) => {
      snapshot.rootId = 'branch_2';
    });
  });

  it('rejects a sequence below a generated ID', () => {
    assertRejected('sequence', (snapshot) => {
      snapshot.seq = 5;
    });
  });

  it('rejects generated ID suffixes outside the safe integer range', () => {
    const snapshot = currentSnapshot();
    const logs = snapshot.logs as Array<Record<string, unknown>>;
    logs[0].id = 'log_9007199254740992';
    snapshot.seq = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(snapshot);

    expect(() => parseStoreSnapshot(snapshot)).toThrow(/unsafe numeric suffix/);
    expect(snapshot).toEqual(before);
  });

  it('accepts a terminal safe sequence for recovery', () => {
    const snapshot = currentSnapshot();
    snapshot.seq = Number.MAX_SAFE_INTEGER;

    expect(parseStoreSnapshot(snapshot).seq).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('accepts failed-attempt logs for a branch that was never committed', () => {
    const snapshot = currentSnapshot();
    const logs = snapshot.logs as Array<Record<string, unknown>>;
    logs[0].branchId = 'attempted-branch';
    logs[0].status = 'failed';

    expect(parseStoreSnapshot(snapshot).logs[0]).toMatchObject({
      branchId: 'attempted-branch',
      status: 'failed',
    });
  });

  it('rejects a sequence below a failed-attempt branch ID', () => {
    assertRejected('failed-attempt branch sequence', (snapshot) => {
      const logs = snapshot.logs as Array<Record<string, unknown>>;
      logs[0].branchId = 'branch_7';
      logs[0].status = 'failed';
      snapshot.seq = 6;
    });
  });

  it('rejects an unsafe failed-attempt branch ID suffix', () => {
    const snapshot = currentSnapshot();
    const logs = snapshot.logs as Array<Record<string, unknown>>;
    logs[0].branchId = 'branch_9007199254740992';
    logs[0].status = 'failed';
    snapshot.seq = Number.MAX_SAFE_INTEGER;

    expect(() => parseStoreSnapshot(snapshot)).toThrow(/unsafe numeric suffix/);
  });
});
