import tree from '@/fixtures/seed-tree.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreSnapshot } from './store-schema';
import { estimateTokens, messagesTokens } from './tokens';
import type { Conversation, InferenceLog, Insight } from './types';
import {
  PersistenceCommitError,
  PersistenceLoadError,
  PersistenceUncertainCommitError,
} from './persistence/errors';
import { KvPersistenceBackend } from './persistence/kv';
import { MemoryPersistenceBackend } from './persistence/memory';
import type {
  PersistenceBackend,
  PersistenceLoadResult,
  PersistenceStatus,
} from './persistence/types';

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
  StoreInactiveTransactionError,
  StoreNestedTransactionError,
  StoreSequenceExhaustedError,
  appendMessage,
  availableTokensFor,
  configureStorePersistenceForTests,
  getConversation,
  listConversations,
  listLogs,
  loadStore,
  logInference,
  nextId,
  putConversation,
  resetStore,
  saveStore,
  transactStore,
  visibleContextFor,
} from './store';

function mockedKvBackend(): KvPersistenceBackend {
  return new KvPersistenceBackend({
    transport: {
      async get(key) {
        const result = (await kvMocks.get(key)) as
          | { status: 'hit'; value: string }
          | { status: 'miss' }
          | { status: 'error' }
          | undefined;
        if (!result || result.status === 'miss') return null;
        if (result.status === 'error') throw new Error('injected KV load failure');
        return result.value;
      },
      async set(key, value) {
        await kvMocks.set(key, value);
      },
    },
  });
}

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
    kvMocks.get.mockResolvedValue({ status: 'miss' });
    kvMocks.set.mockResolvedValue(undefined);
    configureStorePersistenceForTests(mockedKvBackend());
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

    await expect(loadStore()).rejects.toBeInstanceOf(PersistenceLoadError);

    expect(getConversation(sentinel.id)).toEqual(sentinel);
    expect(getConversation('invalid-root')).toBeUndefined();
  });

  it('boots only the root when the supported development fixture flag is set', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BONSAI_ROOT_ONLY_FIXTURE', '1');
    configureStorePersistenceForTests(new MemoryPersistenceBackend());

    await resetStore();

    expect(listConversations()).toHaveLength(1);
  });

  it('never reads or writes KV while the development root-only fixture flag is active', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BONSAI_ROOT_ONLY_FIXTURE', '1');
    kvMocks.get.mockResolvedValue({ status: 'miss' });
    configureStorePersistenceForTests(new MemoryPersistenceBackend());

    await resetStore();
    await loadStore();

    expect(kvMocks.get).not.toHaveBeenCalled();
    expect(kvMocks.set).not.toHaveBeenCalled();
  });

  it('ignores the root-only fixture flag in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BONSAI_ROOT_ONLY_FIXTURE', '1');
    configureStorePersistenceForTests(new MemoryPersistenceBackend());

    await resetStore();

    expect(listConversations().length).toBeGreaterThan(1);
  });
});

function transactionSnapshot(title = 'Transaction root'): StoreSnapshot {
  return {
    conversations: [
      {
        id: 'transaction-root',
        title,
        parentId: null,
        messages: [],
        insights: [],
        pinnedTier: null,
        archived: false,
      },
    ],
    logs: [],
    rootId: 'transaction-root',
    seq: 0,
  };
}

function transactionLog(id: string): InferenceLog {
  return {
    id,
    ts: '2026-08-11T00:00:00.000Z',
    branchId: 'transaction-root',
    purpose: 'chat',
    tier: 'quick',
    model: 'bonsai-fast',
    effort: 'low',
    inputTokens: 1,
    outputTokens: 1,
    estCostUsd: 0,
    status: 'failed',
    escalated: false,
    overridden: false,
    baselineInputTokens: 0,
    baselineCostUsd: 0,
  };
}

describe('durable store transactions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serializes concurrent mutations and preserves unique sequence IDs', async () => {
    const commits: StoreSnapshot[] = [];
    const backend = new MemoryPersistenceBackend({
      initialSnapshot: transactionSnapshot(),
      beforeCommit: (_previous, next) => {
        commits.push(structuredClone(next));
      },
    });
    configureStorePersistenceForTests(backend);
    await loadStore();

    const first = transactStore(async () => {
      await Promise.resolve();
      const id = nextId('msg');
      appendMessage('transaction-root', { id, role: 'user', content: 'first' });
      return id;
    });
    const second = transactStore(async () => {
      const id = nextId('msg');
      appendMessage('transaction-root', { id, role: 'user', content: 'second' });
      return id;
    });

    await expect(Promise.all([first, second])).resolves.toEqual(['msg_1', 'msg_2']);
    expect(getConversation('transaction-root')?.messages.map((message) => message.id)).toEqual([
      'msg_1',
      'msg_2',
    ]);
    expect(commits).toHaveLength(2);
  });

  it('never exposes a paused draft and publishes only after confirmed commit', async () => {
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    let commitStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      commitStarted = resolve;
    });
    const backend = new MemoryPersistenceBackend({
      initialSnapshot: transactionSnapshot(),
      beforeCommit: async () => {
        commitStarted();
        await commitGate;
      },
    });
    configureStorePersistenceForTests(backend);
    await loadStore();

    const transaction = transactStore(() => {
      appendMessage('transaction-root', { id: nextId('msg'), role: 'user', content: 'draft' });
    });
    await started;

    expect(getConversation('transaction-root')?.messages).toEqual([]);
    const queuedRead = loadStore();
    let readFinished = false;
    void queuedRead.then(() => {
      readFinished = true;
    });
    await Promise.resolve();
    expect(readFinished).toBe(false);

    releaseCommit();
    await transaction;
    await queuedRead;
    expect(getConversation('transaction-root')?.messages.map((message) => message.id)).toEqual([
      'msg_1',
    ]);
  });

  it('restores the authoritative prior state after callback or confirmed commit failure and advances the queue', async () => {
    let attempts = 0;
    const backend = new MemoryPersistenceBackend({
      initialSnapshot: transactionSnapshot(),
      beforeCommit: () => {
        attempts += 1;
        if (attempts === 1) throw new PersistenceCommitError('injected commit failure');
      },
    });
    configureStorePersistenceForTests(backend);
    await loadStore();

    await expect(
      transactStore(() => {
        const messageId = nextId('msg');
        appendMessage('transaction-root', { id: messageId, role: 'user', content: 'rejected' });
        logInference(transactionLog(nextId('log')));
      }),
    ).rejects.toBeInstanceOf(PersistenceCommitError);
    expect(getConversation('transaction-root')?.messages).toEqual([]);
    expect(listLogs()).toEqual([]);

    await expect(
      transactStore(() => {
        appendMessage('transaction-root', {
          id: nextId('msg'),
          role: 'user',
          content: 'accepted',
        });
      }),
    ).resolves.toBeUndefined();
    expect(getConversation('transaction-root')?.messages.map((message) => message.id)).toEqual([
      'msg_1',
    ]);

    await expect(
      transactStore(() => {
        appendMessage('transaction-root', {
          id: nextId('msg'),
          role: 'user',
          content: 'callback failure',
        });
        throw new Error('callback failed');
      }),
    ).rejects.toThrow('callback failed');
    expect(getConversation('transaction-root')?.messages).toHaveLength(1);
  });

  it('commits messages and logs together and supports a log-only failed-provider transaction', async () => {
    const commits: StoreSnapshot[] = [];
    configureStorePersistenceForTests(
      new MemoryPersistenceBackend({
        initialSnapshot: transactionSnapshot(),
        beforeCommit: (_previous, next) => {
          commits.push(structuredClone(next));
        },
      }),
    );
    await loadStore();

    await transactStore(() => {
      appendMessage('transaction-root', {
        id: nextId('msg'),
        role: 'user',
        content: 'accepted message',
      });
      logInference(transactionLog(nextId('log')));
    });
    expect(commits).toHaveLength(1);
    expect(commits[0].conversations[0].messages).toHaveLength(1);
    expect(commits[0].logs).toHaveLength(1);

    const messagesBefore = getConversation('transaction-root')?.messages;
    await transactStore(() => {
      logInference(transactionLog(nextId('log')));
    });
    expect(getConversation('transaction-root')?.messages).toEqual(messagesBefore);
    expect(listLogs()).toHaveLength(2);
    expect(commits).toHaveLength(2);
  });

  it('restores the last loaded durable snapshot when legacy save compatibility fails', async () => {
    configureStorePersistenceForTests(
      new MemoryPersistenceBackend({
        initialSnapshot: transactionSnapshot(),
        beforeCommit: () => {
          throw new PersistenceCommitError('injected commit failure');
        },
      }),
    );
    await loadStore();
    putConversation({
      id: 'legacy-undurable',
      title: 'Legacy undurable',
      parentId: null,
      messages: [],
      insights: [],
      pinnedTier: null,
      archived: false,
    });

    await expect(saveStore()).rejects.toBeInstanceOf(PersistenceCommitError);
    expect(getConversation('legacy-undurable')).toBeUndefined();
    expect(getConversation('transaction-root')?.title).toBe('Transaction root');
  });

  it('reloads the backend-visible winner after an uncertain commit and poisons later mutations', async () => {
    const visible = transactionSnapshot('Backend-visible winner');
    let commits = 0;
    const backend: PersistenceBackend = {
      kind: 'file',
      async load(): Promise<PersistenceLoadResult> {
        return {
          status: 'ready',
          snapshot: structuredClone(visible),
          persistence: this.status(),
        };
      },
      async commit(): Promise<PersistenceStatus> {
        commits += 1;
        visible.conversations[0].title = 'Authoritative uncertain winner';
        throw new PersistenceUncertainCommitError('uncertain');
      },
      status(): PersistenceStatus {
        return {
          backend: 'file',
          health: commits > 0 ? 'error' : 'ready',
          durable: true,
          revision: commits > 0 ? 2 : 1,
        };
      },
    };
    configureStorePersistenceForTests(backend);
    await loadStore();

    await expect(
      transactStore(() => {
        appendMessage('transaction-root', { id: nextId('msg'), role: 'user', content: 'draft' });
      }),
    ).rejects.toBeInstanceOf(PersistenceUncertainCommitError);
    expect(getConversation('transaction-root')?.title).toBe('Authoritative uncertain winner');
    expect(getConversation('transaction-root')?.messages).toEqual([]);

    await expect(transactStore(() => undefined)).rejects.toBeInstanceOf(
      PersistenceUncertainCommitError,
    );
    expect(commits).toBe(1);
  });

  it.each(['miss', 'error'] as const)(
    'blocks stale reads after an uncertain commit whose reconciliation returns a %s',
    async (reconciliation) => {
      const initial = transactionSnapshot('Initial authoritative state');
      const recovered = transactionSnapshot('Recovered authoritative state');
      let loads = 0;
      const backend: PersistenceBackend = {
        kind: 'file',
        async load(): Promise<PersistenceLoadResult> {
          loads += 1;
          if (loads === 2) {
            if (reconciliation === 'error') {
              throw new PersistenceLoadError('authoritative reload failed');
            }
            return { status: 'miss', persistence: this.status() };
          }
          return {
            status: 'ready',
            snapshot: structuredClone(loads === 1 ? initial : recovered),
            persistence: this.status(),
          };
        },
        async commit(): Promise<PersistenceStatus> {
          throw new PersistenceUncertainCommitError('uncertain');
        },
        status(): PersistenceStatus {
          return { backend: 'file', health: 'error', durable: true, revision: null };
        },
      };
      configureStorePersistenceForTests(backend);

      await expect(transactStore(() => undefined)).rejects.toBeInstanceOf(
        PersistenceUncertainCommitError,
      );
      expect(() => getConversation('transaction-root')).toThrow(
        PersistenceUncertainCommitError,
      );
      expect(() => listConversations()).toThrow(PersistenceUncertainCommitError);

      await loadStore();
      expect(getConversation('transaction-root')?.title).toBe('Recovered authoritative state');
      await expect(transactStore(() => undefined)).rejects.toBeInstanceOf(
        PersistenceUncertainCommitError,
      );
    },
  );

  it('rejects nested transactions and transaction-local loads without deadlocking', async () => {
    configureStorePersistenceForTests(
      new MemoryPersistenceBackend({ initialSnapshot: transactionSnapshot() }),
    );
    await loadStore();

    await expect(transactStore(() => transactStore(() => undefined))).rejects.toBeInstanceOf(
      StoreNestedTransactionError,
    );
    await expect(transactStore(() => loadStore())).rejects.toBeInstanceOf(
      StoreNestedTransactionError,
    );
  });

  it('invalidates detached async draft work and clones every published boundary', async () => {
    configureStorePersistenceForTests(
      new MemoryPersistenceBackend({ initialSnapshot: transactionSnapshot() }),
    );
    await loadStore();
    let releaseDetached!: () => void;
    const detachedGate = new Promise<void>((resolve) => {
      releaseDetached = resolve;
    });
    let detached!: Promise<void>;
    const external = {
      id: 'independent-root',
      title: 'Independent',
      parentId: null,
      messages: [],
      insights: [],
      pinnedTier: null,
      archived: false,
    } satisfies Conversation;

    const returned = await transactStore(() => {
      putConversation(external);
      detached = Promise.resolve().then(async () => {
        await detachedGate;
        appendMessage('transaction-root', {
          id: 'detached-message',
          role: 'user',
          content: 'must not publish',
        });
      });
      return getConversation('independent-root');
    });

    external.title = 'Mutated input';
    if (returned) returned.title = 'Mutated return';
    const published = getConversation('independent-root');
    if (published) published.title = 'Mutated read';
    expect(getConversation('independent-root')?.title).toBe('Independent');

    releaseDetached();
    await expect(detached).rejects.toBeInstanceOf(StoreInactiveTransactionError);
    expect(getConversation('transaction-root')?.messages).toEqual([]);
  });

  it('seeds a miss once, never seeds a load error, and resets with a replacement log epoch', async () => {
    const commitOptions: Array<{ replaceInferenceLogView?: boolean }> = [];
    const missing = new MemoryPersistenceBackend({
      beforeCommit: (_previous, _next, options) => {
        commitOptions.push(options);
      },
    });
    configureStorePersistenceForTests(missing);
    await loadStore();
    await loadStore();
    expect(commitOptions).toEqual([{}]);

    await resetStore();
    expect(commitOptions.at(-1)).toEqual({ replaceInferenceLogView: true });

    const commit = vi.fn();
    configureStorePersistenceForTests(
      new MemoryPersistenceBackend({
        beforeLoad: () => {
          throw new PersistenceLoadError('load failed');
        },
        beforeCommit: commit,
      }),
    );
    await expect(loadStore()).rejects.toBeInstanceOf(PersistenceLoadError);
    expect(commit).not.toHaveBeenCalled();
  });
});
