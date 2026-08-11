import { describe, expect, it, vi } from 'vitest';
import type { StoreSnapshot } from '../store-schema';
import type { InferenceLog } from '../types';
import { PersistenceCommitError, PersistenceConflictError } from './errors';
import { MemoryPersistenceBackend } from './memory';

function log(id: string): InferenceLog {
  return {
    id,
    ts: '2026-08-11T00:00:00.000Z',
    branchId: 'root',
    purpose: 'chat',
    tier: 'quick',
    model: 'bonsai-fast',
    effort: 'low',
    inputTokens: 1,
    outputTokens: 1,
    estCostUsd: 0,
    status: 'succeeded',
    escalated: false,
    overridden: false,
    baselineInputTokens: 1,
    baselineCostUsd: 0,
  };
}

function snapshot(title = 'Root', logs: InferenceLog[] = []): StoreSnapshot {
  return {
    conversations: [
      {
        id: 'root',
        title,
        parentId: null,
        messages: [],
        insights: [],
        pinnedTier: null,
        archived: false,
      },
    ],
    logs,
    rootId: 'root',
    seq: logs.reduce((maximum, entry) => {
      const suffix = Number(entry.id.split('_').at(-1));
      return Number.isSafeInteger(suffix) ? Math.max(maximum, suffix) : maximum;
    }, 0),
  };
}

describe('MemoryPersistenceBackend', () => {
  it('distinguishes a miss, clones inputs and outputs, and advances revisions', async () => {
    const backend = new MemoryPersistenceBackend();
    const initial = snapshot();

    await expect(backend.load()).resolves.toEqual({
      status: 'miss',
      persistence: { backend: 'memory', health: 'ready', durable: false, revision: null },
    });
    await expect(backend.commit(null, initial)).resolves.toEqual({
      backend: 'memory',
      health: 'ready',
      durable: false,
      revision: 1,
    });

    initial.conversations[0].title = 'Mutated input';
    const loaded = await backend.load();
    if (loaded.status === 'miss') throw new Error('expected memory hit');
    loaded.snapshot.conversations[0].title = 'Mutated output';

    const reloaded = await backend.load();
    if (reloaded.status === 'miss') throw new Error('expected memory hit');
    expect(reloaded.snapshot.conversations[0].title).toBe('Root');
  });

  it('rejects stale previous snapshots and non-prefix log rewrites', async () => {
    const backend = new MemoryPersistenceBackend({ initialSnapshot: snapshot('One', [log('log_1')]) });
    const current = snapshot('One', [log('log_1')]);

    await expect(backend.commit(snapshot('Stale', [log('log_1')]), current)).rejects.toBeInstanceOf(
      PersistenceConflictError,
    );
    await expect(
      backend.commit(current, snapshot('Two', [log('log_2')])),
    ).rejects.toBeInstanceOf(PersistenceCommitError);
  });

  it('allows an explicit inference-log replacement epoch and injects failures before mutation', async () => {
    const beforeCommit = vi.fn().mockRejectedValueOnce(new Error('secret upstream detail'));
    const initial = snapshot('One', [log('log_1')]);
    const backend = new MemoryPersistenceBackend({ initialSnapshot: initial, beforeCommit });

    await expect(
      backend.commit(initial, snapshot('Two', [log('log_2')]), {
        replaceInferenceLogView: true,
      }),
    ).rejects.toBeInstanceOf(PersistenceCommitError);
    const unchanged = await backend.load();
    if (unchanged.status === 'miss') throw new Error('expected memory hit');
    expect(unchanged.snapshot).toEqual(initial);

    await expect(
      backend.commit(initial, snapshot('Two', [log('log_2')]), {
        replaceInferenceLogView: true,
      }),
    ).resolves.toMatchObject({ revision: 2 });
    expect(beforeCommit).toHaveBeenCalledTimes(2);
  });

  it('does not let a commit observer mutate the persisted snapshot', async () => {
    const initial = snapshot('One');
    const backend = new MemoryPersistenceBackend({
      initialSnapshot: initial,
      beforeCommit: (_previous, next) => {
        next.conversations[0].title = 'Hook mutation';
      },
    });

    await backend.commit(initial, snapshot('Two'));

    const loaded = await backend.load();
    if (loaded.status === 'miss') throw new Error('expected memory hit');
    expect(loaded.snapshot.conversations[0].title).toBe('Two');
  });
});
