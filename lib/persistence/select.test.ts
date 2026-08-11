import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PersistenceConfigurationError } from './errors';
import { FilePersistenceBackend } from './file';
import { KvPersistenceBackend } from './kv';
import { MemoryPersistenceBackend } from './memory';
import { selectPersistenceBackend } from './select';

const completeKv = { DATABASE_URL: 'postgres://configured' };

describe('selectPersistenceBackend', () => {
  it('always selects memory for tests', () => {
    expect(
      selectPersistenceBackend({
        env: { NODE_ENV: 'test', BONSAI_PERSISTENCE_BACKEND: 'invalid', ...completeKv },
        cwd: '/workspace',
      }),
    ).toBeInstanceOf(MemoryPersistenceBackend);
  });

  it('bypasses inherited KV and file configuration for non-production root-only fixtures', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'bonsai-selector-'));
    const configuredDataDir = join(cwd, 'configured-data');
    try {
      expect(
        selectPersistenceBackend({
          env: {
            NODE_ENV: 'development',
            BONSAI_ROOT_ONLY_FIXTURE: '1',
            VERCEL: '1',
            BONSAI_PERSISTENCE_BACKEND: 'kv',
            BONSAI_DATA_DIR: configuredDataDir,
            ...completeKv,
            UPSTASH_REDIS_REST_URL: 'https://redis.example',
            UPSTASH_REDIS_REST_TOKEN: 'configured',
            KV_REST_API_URL: 'https://kv.example',
            KV_REST_API_TOKEN: 'configured',
          },
          cwd,
        }),
      ).toBeInstanceOf(MemoryPersistenceBackend);
      expect(existsSync(join(cwd, '.bonsai'))).toBe(false);
      expect(existsSync(configuredDataDir)).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
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
        env: {
          NODE_ENV: 'production',
          BONSAI_ROOT_ONLY_FIXTURE: '1',
          VERCEL: '1',
          ...completeKv,
        },
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
