import { describe, expect, it, vi } from 'vitest';
import type { StoreSnapshot } from '../store-schema';
import { createKvTransport } from '../kv';
import {
  PersistenceCommitError,
  PersistenceConfigurationError,
  PersistenceLoadError,
  PersistenceUncertainCommitError,
} from './errors';
import { KvPersistenceBackend } from './kv';

function snapshot(title = 'Root'): StoreSnapshot {
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
    logs: [],
    rootId: 'root',
    seq: 0,
  };
}

describe('KvPersistenceBackend', () => {
  it('distinguishes a miss and validates cloned snapshots with process-local null revisions', async () => {
    let stored: string | null = null;
    const transport = {
      get: vi.fn(async () => stored),
      set: vi.fn(async (_key: string, value: string) => {
        stored = value;
      }),
    };
    const backend = new KvPersistenceBackend({ transport });

    await expect(backend.load()).resolves.toEqual({
      status: 'miss',
      persistence: { backend: 'kv', health: 'ready', durable: true, revision: null },
    });
    const next = snapshot();
    await expect(backend.commit(null, next)).resolves.toEqual({
      backend: 'kv',
      health: 'ready',
      durable: true,
      revision: null,
    });
    next.conversations[0].title = 'Mutated input';
    const loaded = await backend.load();
    if (loaded.status === 'miss') throw new Error('expected KV hit');
    expect(loaded.snapshot.conversations[0].title).toBe('Root');
  });

  it('turns configured read, write, oversized, and malformed payload failures into safe typed errors', async () => {
    const raw = 'postgres://username:password@private.example/db';
    const readFailure = new KvPersistenceBackend({
      transport: { get: vi.fn().mockRejectedValue(new Error(raw)), set: vi.fn() },
    });
    const writeFailure = new KvPersistenceBackend({
      transport: { get: vi.fn(), set: vi.fn().mockRejectedValue(new Error(raw)) },
    });

    await expect(readFailure.load()).rejects.toEqual(
      expect.objectContaining({ name: 'PersistenceLoadError' }),
    );
    await expect(readFailure.load()).rejects.not.toThrow(raw);
    await expect(writeFailure.commit(null, snapshot())).rejects.toEqual(
      expect.objectContaining({ name: 'PersistenceUncertainCommitError' }),
    );
    await expect(writeFailure.commit(null, snapshot())).rejects.not.toThrow(raw);
    await expect(writeFailure.commit(null, snapshot())).rejects.toBeInstanceOf(
      PersistenceUncertainCommitError,
    );

    const malformed = new KvPersistenceBackend({
      transport: { get: vi.fn().mockResolvedValue('{"rootId":"bad"}'), set: vi.fn() },
    });
    await expect(malformed.load()).rejects.toBeInstanceOf(PersistenceLoadError);

    const bounded = new KvPersistenceBackend({
      transport: { get: vi.fn(), set: vi.fn() },
      maxPayloadBytes: 32,
    });
    await expect(bounded.commit(null, snapshot())).rejects.toBeInstanceOf(PersistenceCommitError);
  });

  it('keeps an ambiguous writer poisoned while allowing authoritative reloads', async () => {
    const visible = snapshot('Backend-visible winner');
    const transport = {
      get: vi.fn().mockResolvedValue(JSON.stringify(visible)),
      set: vi.fn().mockRejectedValue(new Error('response lost')),
    };
    const backend = new KvPersistenceBackend({ transport });

    await expect(backend.commit(visible, snapshot('Attempted update'))).rejects.toBeInstanceOf(
      PersistenceUncertainCommitError,
    );
    await expect(backend.load()).resolves.toMatchObject({
      status: 'ready',
      snapshot: visible,
      persistence: { health: 'error' },
    });
    await expect(backend.commit(visible, snapshot('Retry'))).rejects.toBeInstanceOf(
      PersistenceUncertainCommitError,
    );
    expect(transport.set).toHaveBeenCalledTimes(1);
  });
});

describe('createKvTransport', () => {
  it('requires complete runtime configuration', () => {
    expect(() => createKvTransport({ env: {} })).toThrow(PersistenceConfigurationError);
    expect(() =>
      createKvTransport({ env: { UPSTASH_REDIS_REST_URL: 'https://redis.example' } }),
    ).toThrow(PersistenceConfigurationError);
  });

  it('treats Upstash non-2xx reads and writes as failures', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    const transport = createKvTransport({
      env: {
        UPSTASH_REDIS_REST_URL: 'https://redis.example',
        UPSTASH_REDIS_REST_TOKEN: 'token',
      },
      fetch,
    });

    await expect(transport.get('bonsai:store:v1')).rejects.toThrow();
    await expect(transport.set('bonsai:store:v1', '{}')).rejects.toThrow();
  });

  it('does not expose Upstash credentials in thrown messages', async () => {
    const secret = 'do-not-leak';
    const transport = createKvTransport({
      env: {
        UPSTASH_REDIS_REST_URL: 'https://redis.example',
        UPSTASH_REDIS_REST_TOKEN: secret,
      },
      fetch: vi.fn().mockRejectedValue(new Error(secret)),
    });

    await expect(transport.get('key')).rejects.not.toThrow(secret);
  });

  it('rejects malformed Upstash success envelopes', async () => {
    const transport = createKvTransport({
      env: {
        UPSTASH_REDIS_REST_URL: 'https://redis.example',
        UPSTASH_REDIS_REST_TOKEN: 'token',
      },
      fetch: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    });

    await expect(transport.get('key')).rejects.toThrow('KV request failed');
    await expect(transport.set('key', '{}')).rejects.toThrow('KV request failed');
  });

  it('accepts the documented Upstash miss and SET acknowledgement envelopes', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"result":null}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"result":"OK"}', { status: 200 }));
    const transport = createKvTransport({
      env: {
        UPSTASH_REDIS_REST_URL: 'https://redis.example',
        UPSTASH_REDIS_REST_TOKEN: 'token',
      },
      fetch,
    });

    await expect(transport.get('key')).resolves.toBeNull();
    await expect(transport.set('key', '{}')).resolves.toBeUndefined();
  });

  it('rejects Upstash bodies that exceed declared or streamed response limits', async () => {
    const cancel = vi.fn();
    const declaredBody = new ReadableStream<Uint8Array>({ cancel });
    const declaredOversize = createKvTransport({
      env: {
        UPSTASH_REDIS_REST_URL: 'https://redis.example',
        UPSTASH_REDIS_REST_TOKEN: 'token',
      },
      fetch: vi.fn().mockResolvedValue(
        new Response(declaredBody, {
          status: 200,
          headers: { 'content-length': '65' },
        }),
      ),
      maxResponseBytes: 64,
    });
    await expect(declaredOversize.get('key')).rejects.toThrow('KV request failed');
    expect(cancel).toHaveBeenCalledOnce();

    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 'x'.repeat(128) })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: 'OK', padding: 'x'.repeat(128) })),
      );
    const streamedOversize = createKvTransport({
      env: {
        UPSTASH_REDIS_REST_URL: 'https://redis.example',
        UPSTASH_REDIS_REST_TOKEN: 'token',
      },
      fetch,
      maxResponseBytes: 64,
    });

    await expect(streamedOversize.get('key')).rejects.toThrow('KV request failed');
    await expect(streamedOversize.set('key', '{}')).rejects.toThrow('KV request failed');
  });
});
