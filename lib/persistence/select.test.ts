import { describe, expect, it, vi } from 'vitest';
import { PersistenceConfigurationError } from './errors';
import { FilePersistenceBackend } from './file';
import { KvPersistenceBackend } from './kv';
import { MemoryPersistenceBackend } from './memory';
import { selectPersistenceBackend } from './select';

const completeKv = { DATABASE_URL: 'postgres://configured' };

describe('selectPersistenceBackend', () => {
  it('always selects memory for tests and non-production root-only fixtures', () => {
    expect(
      selectPersistenceBackend({
        env: { NODE_ENV: 'test', BONSAI_PERSISTENCE_BACKEND: 'invalid', ...completeKv },
        cwd: '/workspace',
      }),
    ).toBeInstanceOf(MemoryPersistenceBackend);
    expect(
      selectPersistenceBackend({
        env: {
          NODE_ENV: 'development',
          BONSAI_ROOT_ONLY_FIXTURE: '1',
          VERCEL: '1',
          ...completeKv,
        },
        cwd: '/workspace',
      }),
    ).toBeInstanceOf(MemoryPersistenceBackend);
  });

  it('allows explicit memory only outside production', () => {
    expect(
      selectPersistenceBackend({
        env: { NODE_ENV: 'development', BONSAI_PERSISTENCE_BACKEND: 'memory' },
        cwd: '/workspace',
      }),
    ).toBeInstanceOf(MemoryPersistenceBackend);
    expect(() =>
      selectPersistenceBackend({
        env: { NODE_ENV: 'production', BONSAI_PERSISTENCE_BACKEND: 'memory' },
        cwd: '/workspace',
      }),
    ).toThrow(PersistenceConfigurationError);
  });

  it('selects configured KV on Vercel or when explicit and never falls back', () => {
    expect(
      selectPersistenceBackend({
        env: { NODE_ENV: 'production', VERCEL: '1', ...completeKv },
        cwd: '/workspace',
      }),
    ).toBeInstanceOf(KvPersistenceBackend);
    expect(
      selectPersistenceBackend({
        env: {
          NODE_ENV: 'development',
          BONSAI_PERSISTENCE_BACKEND: 'kv',
          UPSTASH_REDIS_REST_URL: 'https://redis.example',
          UPSTASH_REDIS_REST_TOKEN: 'configured',
        },
        cwd: '/workspace',
      }),
    ).toBeInstanceOf(KvPersistenceBackend);

    expect(() =>
      selectPersistenceBackend({
        env: { NODE_ENV: 'production', VERCEL: '1' },
        cwd: '/workspace',
      }),
    ).toThrow(PersistenceConfigurationError);
    expect(() =>
      selectPersistenceBackend({
        env: { NODE_ENV: 'development', BONSAI_PERSISTENCE_BACKEND: 'kv' },
        cwd: '/workspace',
      }),
    ).toThrow(PersistenceConfigurationError);
  });

  it('uses local files by default even when DATABASE_URL is inherited', () => {
    const backend = selectPersistenceBackend({
      env: { NODE_ENV: 'development', ...completeKv },
      cwd: '/workspace',
    });

    expect(backend).toBeInstanceOf(FilePersistenceBackend);
  });

  it('rejects invalid explicit values and preserves file data-directory validation', () => {
    expect(() =>
      selectPersistenceBackend({
        env: { NODE_ENV: 'development', BONSAI_PERSISTENCE_BACKEND: 'wat' },
        cwd: '/workspace',
      }),
    ).toThrow(PersistenceConfigurationError);
    expect(() =>
      selectPersistenceBackend({
        env: {
          NODE_ENV: 'development',
          BONSAI_PERSISTENCE_BACKEND: 'file',
          BONSAI_DATA_DIR: 'relative',
        },
        cwd: '/workspace',
      }),
    ).toThrow(PersistenceConfigurationError);
  });

  it('resolves environment at selection time instead of module import time', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BONSAI_PERSISTENCE_BACKEND', 'memory');
    expect(selectPersistenceBackend()).toBeInstanceOf(MemoryPersistenceBackend);
    vi.unstubAllEnvs();
  });
});
