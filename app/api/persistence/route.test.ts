import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompleteParams, CompleteResult } from '@/lib/llm';
import { TIER_DEFAULTS } from '@/lib/models';
import { nodeAtomicFileSystem } from '@/lib/persistence/atomic-file';
import {
  PersistenceCommitError,
  PersistenceLoadError,
  PersistenceUncertainCommitError,
} from '@/lib/persistence/errors';
import { FilePersistenceBackend } from '@/lib/persistence/file';
import { KvPersistenceBackend } from '@/lib/persistence/kv';
import { MemoryPersistenceBackend } from '@/lib/persistence/memory';
import type {
  PersistenceBackend,
  PersistenceLoadResult,
  PersistenceStatus,
} from '@/lib/persistence/types';
import { ProviderUnavailableError } from '@/lib/provider';
import type { StoreSnapshot } from '@/lib/store-schema';
import type { Conversation } from '@/lib/types';

const llmMocks = vi.hoisted(() => ({
  complete: vi.fn<(params: CompleteParams) => Promise<CompleteResult>>(),
}));

vi.mock('@/lib/llm', () => ({ complete: llmMocks.complete }));

import { POST as branchPost } from '@/app/api/branch/route';
import { POST as chatPost } from '@/app/api/chat/route';
import { POST as conversationPost } from '@/app/api/conversation/route';
import { GET as economicsGet } from '@/app/api/economics/route';
import { POST as mergePost } from '@/app/api/merge/route';
import { GET as persistenceGet } from '@/app/api/persistence/route';
import { POST as resetPost } from '@/app/api/reset/route';
import { GET as stateGet } from '@/app/api/state/route';
import {
  configureStorePersistenceForTests,
  getConversation,
  loadStore,
} from '@/lib/store';

const ROOT_ID = 'persistence-root';
const CHILD_ID = 'persistence-child';
const tempRoots: string[] = [];

function root(title = 'Persistence root'): Conversation {
  return {
    id: ROOT_ID,
    title,
    parentId: null,
    messages: [{ id: 'root-message', role: 'user', content: 'A persisted fact.' }],
    insights: [],
    pinnedTier: null,
    archived: false,
  };
}

function child(id = CHILD_ID): Conversation {
  const markdown = '# Branch brief\n\nA persisted fact.';
  return {
    id,
    title: 'Persistence child',
    parentId: ROOT_ID,
    messages: [{ id: 'child-message', role: 'assistant', content: 'A durable conclusion.' }],
    brief: {
      id: 'persistence-brief',
      branchId: id,
      selection: 'persisted fact',
      markdown,
      facts: ['A persisted fact.'],
      excludedNote: 'No additional context.',
      availableTokens: 10,
      briefTokens: 8,
      prunedPct: 20,
      sourceRefs: [
        { kind: 'message', conversationId: ROOT_ID, sourceId: 'root-message' },
      ],
      factSourceIds: [['root-message']],
      factProvenance: ['model-cited'],
    },
    insights: [],
    pinnedTier: null,
    archived: false,
  };
}

function snapshot(conversations: Conversation[] = [root()]): StoreSnapshot {
  return { conversations, logs: [], rootId: ROOT_ID, seq: 0 };
}

function request(path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function completion(params: CompleteParams, text: string): CompleteResult {
  return {
    text,
    tier: params.tier,
    model: params.model ?? 'claude-haiku-4-5',
    effort: params.effort ?? TIER_DEFAULTS[params.tier].effort,
    inputTokens: 10,
    outputTokens: 4,
    estCostUsd: 0.00001,
    mock: true,
  };
}

function successfulInference(params: CompleteParams): CompleteResult {
  const system = params.messages[0]?.content ?? '';
  if (system.startsWith('You compile minimal context briefs')) {
    return completion(
      params,
      JSON.stringify({
        facts: [{ text: 'A persisted fact.', sourceIds: [] }],
        excludedNote: 'No additional context.',
      }),
    );
  }
  if (system.startsWith('Extract the single durable conclusion')) {
    return completion(params, 'The parent should retain this durable conclusion.');
  }
  return completion(params, 'A sufficiently complete answer for persistence testing.');
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('persistence API contracts', () => {
  beforeEach(async () => {
    llmMocks.complete.mockReset();
    llmMocks.complete.mockImplementation(async (params) => successfulInference(params));
    configureStorePersistenceForTests(
      new MemoryPersistenceBackend({ initialSnapshot: snapshot([root(), child()]) }),
    );
    await loadStore();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('returns a safe response when configured backend selection fails', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BONSAI_PERSISTENCE_BACKEND', 'kv');
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('KV_REST_API_TOKEN', '');
    Reflect.deleteProperty(globalThis, Symbol.for('bonsai.store.persistence'));

    const response = await persistenceGet();

    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({
      error: 'persistence unavailable',
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  });

  it.each([
    {
      name: 'chat unknown branch',
      status: 404,
      invoke: () => chatPost(request('/api/chat', { branchId: 'missing', content: 'Hello' })),
    },
    {
      name: 'branch unknown parent',
      status: 404,
      invoke: () =>
        branchPost(request('/api/branch', { parentId: 'missing', selection: 'missing parent' })),
    },
    {
      name: 'merge root',
      status: 400,
      invoke: () => mergePost(request('/api/merge', { branchId: ROOT_ID })),
    },
  ])('does not commit the semantic rejection for $name', async ({ status, invoke }) => {
    let commits = 0;
    configureStorePersistenceForTests(
      new MemoryPersistenceBackend({
        initialSnapshot: snapshot(),
        beforeCommit: () => {
          commits += 1;
          throw new PersistenceCommitError('no-op commits must not run');
        },
      }),
    );

    const response = await invoke();

    expect(response.status).toBe(status);
    expect(commits).toBe(0);
  });

  it.each([
    {
      name: 'chat',
      invoke: () =>
        chatPost(
          request('/api/chat', {
            branchId: ROOT_ID,
            content: 'Will this answer commit?',
            mode: { mode: 'manual', model: 'claude-haiku-4-5', effort: 'low' },
          }),
        ),
    },
    {
      name: 'branch',
      invoke: () =>
        branchPost(request('/api/branch', { parentId: ROOT_ID, selection: 'persisted fact' })),
    },
    {
      name: 'merge',
      invoke: () => mergePost(request('/api/merge', { branchId: CHILD_ID })),
    },
    {
      name: 'conversation',
      invoke: () => conversationPost(request('/api/conversation', { title: 'New root' })),
    },
    {
      name: 'reset',
      invoke: () => resetPost(),
    },
  ])('returns a confirmed persistence 503 when $name cannot commit', async ({ invoke }) => {
    configureStorePersistenceForTests(
      new MemoryPersistenceBackend({
        initialSnapshot: snapshot([root(), child()]),
        beforeCommit: () => {
          throw new PersistenceCommitError('sensitive backend detail');
        },
      }),
    );

    const response = await invoke();

    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({
      error: 'persistence commit failed',
      code: 'PERSISTENCE_COMMIT_FAILED',
    });
  });

  it('does not publish a failed durable mutation', async () => {
    configureStorePersistenceForTests(
      new MemoryPersistenceBackend({
        initialSnapshot: snapshot(),
        beforeCommit: () => {
          throw new PersistenceCommitError('commit rejected');
        },
      }),
    );
    await loadStore();

    const response = await conversationPost(
      request('/api/conversation', { title: 'Must not appear' }),
    );

    expect(response.status).toBe(503);
    expect(getConversation(ROOT_ID)?.title).toBe('Persistence root');
    expect((await stateGet()).status).toBe(200);
    expect(((await body(await stateGet())).conversations as Conversation[])).toEqual([root()]);
  });

  it('distinguishes an uncertain commit, reloads authoritative reads, and blocks later writes', async () => {
    let visible = snapshot([root('Original authoritative state')]);
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
        visible = snapshot([root('Authoritative uncertain winner')]);
        throw new PersistenceUncertainCommitError('ambiguous database response');
      },
      status(): PersistenceStatus {
        return {
          backend: 'file',
          health: commits > 0 ? 'error' : 'ready',
          durable: true,
          revision: commits > 0 ? 2 : 1,
          ...(commits > 0 ? { message: 'local persistence requires recovery' } : {}),
        };
      },
    };
    configureStorePersistenceForTests(backend);

    const uncertain = await conversationPost(
      request('/api/conversation', { title: 'Possibly committed' }),
    );
    expect(uncertain.status).toBe(503);
    expect(await body(uncertain)).toEqual({
      error: 'persistence commit outcome uncertain',
      code: 'PERSISTENCE_COMMIT_UNCERTAIN',
    });

    const stateResponse = await stateGet();
    expect(stateResponse.status).toBe(200);
    const state = await body(stateResponse);
    expect((state.conversations as Conversation[])[0]?.title).toBe(
      'Authoritative uncertain winner',
    );
    expect(state.persistence).toMatchObject({ backend: 'file', health: 'error', durable: true });

    const blocked = await conversationPost(request('/api/conversation', { title: 'Blocked' }));
    expect(blocked.status).toBe(503);
    expect((await body(blocked)).code).toBe('PERSISTENCE_COMMIT_UNCERTAIN');
    expect(commits).toBe(1);
  });

  it.each([
    ['state', stateGet],
    ['economics', economicsGet],
  ])('returns a safe 503 when %s cannot load the configured backend', async (_name, get) => {
    configureStorePersistenceForTests(
      new MemoryPersistenceBackend({
        initialSnapshot: snapshot(),
        beforeLoad: () => {
          throw new PersistenceLoadError('/private/path and database response');
        },
      }),
    );

    const response = await get();

    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({
      error: 'persistence unavailable',
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  });

  it('returns safe health even when loading the tree fails', async () => {
    configureStorePersistenceForTests(
      new MemoryPersistenceBackend({
        initialSnapshot: snapshot(),
        beforeLoad: () => {
          throw new PersistenceLoadError('do not expose this load response');
        },
      }),
    );

    const response = await persistenceGet();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      backend: 'memory',
      health: 'error',
      durable: false,
      revision: 1,
      message: 'memory persistence is unavailable',
    });
  });

  it('reports error health when an initial file commit fails before backend health changes', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'bonsai-route-file-failure-'));
    tempRoots.push(tempRoot);
    const fileSystem = { ...nodeAtomicFileSystem };
    fileSystem.mkdir = (async () => {
      throw new Error('injected private filesystem detail');
    }) as typeof nodeAtomicFileSystem.mkdir;
    configureStorePersistenceForTests(
      new FilePersistenceBackend({
        cwd: '/unused',
        env: { NODE_ENV: 'test', BONSAI_DATA_DIR: join(tempRoot, 'state') },
        fileSystem,
      }),
    );

    const response = await persistenceGet();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      backend: 'file',
      health: 'error',
      durable: true,
      revision: null,
      message: 'persistence is unavailable',
    });
  });

  it('includes degraded recovery details in state', async () => {
    const recovered = snapshot([root(), child('recovered-child')]);
    const backend: PersistenceBackend = {
      kind: 'file',
      async load(): Promise<PersistenceLoadResult> {
        return {
          status: 'degraded',
          snapshot: structuredClone(recovered),
          persistence: this.status(),
        };
      },
      async commit(): Promise<PersistenceStatus> {
        throw new Error('not used');
      },
      status(): PersistenceStatus {
        return {
          backend: 'file',
          health: 'degraded',
          durable: true,
          revision: 7,
          message: 'local persistence recovered an earlier conversation revision',
          recoveredConversationIds: ['recovered-child'],
        };
      },
    };
    configureStorePersistenceForTests(backend);

    const response = await stateGet();

    expect(response.status).toBe(200);
    expect((await body(response)).persistence).toEqual(backend.status());
  });

  it('reports memory as non-durable and file and KV as durable', async () => {
    configureStorePersistenceForTests(new MemoryPersistenceBackend({ initialSnapshot: snapshot() }));
    expect(await persistenceGet().then((response) => response.json())).toMatchObject({
      backend: 'memory',
      durable: false,
    });

    const tempRoot = await mkdtemp(join(tmpdir(), 'bonsai-route-persistence-'));
    tempRoots.push(tempRoot);
    configureStorePersistenceForTests(
      new FilePersistenceBackend({
        cwd: '/unused',
        env: { NODE_ENV: 'test', BONSAI_DATA_DIR: join(tempRoot, 'state') },
      }),
    );
    expect(await persistenceGet().then((response) => response.json())).toMatchObject({
      backend: 'file',
      durable: true,
    });

    let kvValue: string | null = null;
    configureStorePersistenceForTests(
      new KvPersistenceBackend({
        transport: {
          async get() {
            return kvValue;
          },
          async set(_key, value) {
            kvValue = value;
          },
        },
      }),
    );
    expect(await persistenceGet().then((response) => response.json())).toMatchObject({
      backend: 'kv',
      durable: true,
    });
  });

  it('keeps provider 502 distinct from persistence 503', async () => {
    llmMocks.complete.mockRejectedValueOnce(new ProviderUnavailableError('provider secret'));
    const providerResponse = await chatPost(
      request('/api/chat', {
        branchId: ROOT_ID,
        content: 'Provider failure?',
        mode: { mode: 'manual', model: 'claude-haiku-4-5', effort: 'low' },
      }),
    );
    expect(providerResponse.status).toBe(502);
    expect(await body(providerResponse)).toEqual({
      error: 'inference provider unavailable',
      code: 'PROVIDER_UNAVAILABLE',
    });

    configureStorePersistenceForTests(
      new MemoryPersistenceBackend({
        initialSnapshot: snapshot(),
        beforeCommit: () => {
          throw new PersistenceCommitError('private commit detail');
        },
      }),
    );
    llmMocks.complete.mockImplementation(async (params) => successfulInference(params));
    const persistenceResponse = await chatPost(
      request('/api/chat', {
        branchId: ROOT_ID,
        content: 'Persistence failure?',
        mode: { mode: 'manual', model: 'claude-haiku-4-5', effort: 'low' },
      }),
    );
    expect(persistenceResponse.status).toBe(503);
    expect((await body(persistenceResponse)).code).toBe('PERSISTENCE_COMMIT_FAILED');
  });

  it('does not commit when a manual first answer fails before any inference event completes', async () => {
    let commits = 0;
    configureStorePersistenceForTests(
      new MemoryPersistenceBackend({
        initialSnapshot: snapshot(),
        beforeCommit: () => {
          commits += 1;
          throw new PersistenceCommitError('must not mask the provider failure');
        },
      }),
    );
    llmMocks.complete.mockRejectedValueOnce(new ProviderUnavailableError('provider unavailable'));

    const response = await chatPost(
      request('/api/chat', {
        branchId: ROOT_ID,
        content: 'Does a first-answer failure remain a provider failure?',
        mode: { mode: 'manual', model: 'claude-haiku-4-5', effort: 'low' },
      }),
    );

    expect(response.status).toBe(502);
    expect(await body(response)).toEqual({
      error: 'inference provider unavailable',
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(commits).toBe(0);
  });
});
