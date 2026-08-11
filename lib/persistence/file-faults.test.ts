import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  truncate,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreSnapshot } from '../store-schema';
import type { Conversation, InferenceLog } from '../types';
import { nodeAtomicFileSystem } from './atomic-file';
import type { AtomicFileSystem } from './atomic-file';
import {
  PersistenceCommitError,
  PersistenceConfigurationError,
  PersistenceUncertainCommitError,
} from './errors';
import { FilePersistenceBackend } from './file';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempDataDirectory(): Promise<{ root: string; dataDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'bonsai-fault-test-'));
  tempRoots.push(root);
  return { root, dataDir: join(root, 'state') };
}

function backend(
  dataDir: string,
  fileSystem: AtomicFileSystem = nodeAtomicFileSystem,
  resourceLimits?: {
    maxActiveLogBytes?: number;
    maxActiveLogRecords?: number;
    maxConversationDirectoryEntries?: number;
    maxTotalConversationBytes?: number;
  },
): FilePersistenceBackend {
  return new FilePersistenceBackend({
    cwd: '/unused',
    env: { NODE_ENV: 'test', BONSAI_DATA_DIR: dataDir },
    fileSystem,
    ...(resourceLimits ? { resourceLimits } : {}),
  });
}

function rootConversation(title: string): Conversation {
  return {
    id: 'root',
    title,
    parentId: null,
    messages: [],
    insights: [],
    pinnedTier: null,
    archived: false,
  };
}

function inferenceLog(sequence: number): InferenceLog {
  return {
    id: `log_${sequence}`,
    ts: `2026-08-11T00:00:0${sequence}.000Z`,
    branchId: 'root',
    purpose: 'chat',
    tier: 'quick',
    model: 'bonsai-fast',
    effort: 'low',
    inputTokens: sequence,
    outputTokens: sequence,
    estCostUsd: sequence / 1000,
    status: 'succeeded',
    escalated: false,
    overridden: false,
    baselineInputTokens: sequence,
    baselineCostUsd: sequence / 500,
  };
}

function snapshot(
  title: string,
  logs: InferenceLog[] = [],
  seq = logs.length,
): StoreSnapshot {
  return { conversations: [rootConversation(title)], logs, rootId: 'root', seq };
}

interface Faults {
  beforeNodePublish?: boolean;
  beforeManifestRename?: boolean;
  failFinalDirectorySync?: boolean;
  failQuarantineDirectorySync?: boolean;
  failRecoveredSourceUnlink?: boolean;
  failRollbackDirectorySync?: boolean;
}

function faultingFileSystem(dataDir: string, faults: Faults): AtomicFileSystem {
  const fileSystem = { ...nodeAtomicFileSystem };
  let publishedManifestCount = 0;
  let dataSyncCount = 0;

  fileSystem.link = (async (existingPath, newPath) => {
    if (
      faults.beforeNodePublish &&
      basename(String(newPath)).match(/^root\.r\d+\.json$/)
    ) {
      throw new Error('injected node publish failure');
    }
    return nodeAtomicFileSystem.link(existingPath, newPath);
  }) as AtomicFileSystem['link'];

  fileSystem.rename = (async (oldPath, newPath) => {
    if (basename(String(newPath)) === 'manifest.json') {
      if (faults.beforeManifestRename && publishedManifestCount === 0) {
        throw new Error('injected manifest rename failure');
      }
      await nodeAtomicFileSystem.rename(oldPath, newPath);
      publishedManifestCount += 1;
      return;
    }
    return nodeAtomicFileSystem.rename(oldPath, newPath);
  }) as AtomicFileSystem['rename'];

  fileSystem.unlink = (async (path) => {
    if (
      faults.failRecoveredSourceUnlink &&
      basename(String(path)) === 'root.r2.json'
    ) {
      throw new Error('injected recovered source unlink failure');
    }
    return nodeAtomicFileSystem.unlink(path);
  }) as AtomicFileSystem['unlink'];

  fileSystem.open = (async (path: string, flags: string | number, mode?: number) => {
    const handle = await nodeAtomicFileSystem.open(path, flags, mode);
    const quarantineDirectory = join(dataDir, 'quarantine');
    if (path !== dataDir && path !== quarantineDirectory) return handle;
    return new Proxy(handle, {
      get(target, property) {
        if (property === 'sync') {
          return async () => {
            if (path === quarantineDirectory && faults.failQuarantineDirectorySync) {
              throw new Error('injected quarantine directory sync failure');
            }
            if (publishedManifestCount > 0) {
              dataSyncCount += 1;
              if (
                (dataSyncCount === 1 && faults.failFinalDirectorySync) ||
                (dataSyncCount === 2 && faults.failRollbackDirectorySync)
              ) {
                throw new Error('injected data directory sync failure');
              }
            }
            return target.sync();
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }) as AtomicFileSystem['open'];

  return fileSystem;
}

async function readySnapshot(dataDir: string): Promise<StoreSnapshot> {
  const loaded = await backend(dataDir).load();
  expect(loaded.status).toBe('ready');
  if (loaded.status !== 'ready') throw new Error('expected ready persistence');
  return loaded.snapshot;
}

async function readManifest(dataDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dataDir, 'manifest.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error: unknown) {
    return error instanceof Error && 'code' in error && error.code !== 'ENOENT';
  }
}

describe('deterministic commit faults', () => {
  it('loads the old revision after failure before node publication', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    await backend(dataDir).commit(null, initial);

    await expect(
      backend(dataDir, faultingFileSystem(dataDir, { beforeNodePublish: true })).commit(
        initial,
        snapshot('Changed'),
      ),
    ).rejects.toBeInstanceOf(PersistenceCommitError);

    expect(await readySnapshot(dataDir)).toEqual(initial);
    expect(await readdir(join(dataDir, 'conversations'))).toEqual(['root.r1.json']);
  });

  it('ignores a published orphan node when manifest publication fails', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    await backend(dataDir).commit(null, initial);

    await expect(
      backend(dataDir, faultingFileSystem(dataDir, { beforeManifestRename: true })).commit(
        initial,
        snapshot('Changed'),
      ),
    ).rejects.toBeInstanceOf(PersistenceCommitError);

    expect(await readySnapshot(dataDir)).toEqual(initial);
    expect(await readdir(join(dataDir, 'conversations'))).toEqual([
      'root.r1.json',
      'root.r2.json',
    ]);
  });

  it('ignores and later truncates a JSONL suffix from a failed manifest publication', async () => {
    const { dataDir } = await tempDataDirectory();
    const first = inferenceLog(1);
    const second = inferenceLog(2);
    const initial = snapshot('Initial', [first], 1);
    const next = snapshot('Changed', [first, second], 2);
    await backend(dataDir).commit(null, initial);

    await expect(
      backend(dataDir, faultingFileSystem(dataDir, { beforeManifestRename: true })).commit(
        initial,
        next,
      ),
    ).rejects.toBeInstanceOf(PersistenceCommitError);

    expect(await readySnapshot(dataDir)).toEqual(initial);
    const logPath = join(dataDir, 'inference-log.jsonl');
    expect((await readFile(logPath, 'utf8')).trim().split('\n')).toHaveLength(2);
    await backend(dataDir).commit(initial, next);
    expect((await readFile(logPath, 'utf8')).trim().split('\n')).toHaveLength(2);
    expect(await readySnapshot(dataDir)).toEqual(next);
  });

  it('confirms rollback after final manifest directory sync fails', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    await backend(dataDir).commit(null, initial);

    await expect(
      backend(
        dataDir,
        faultingFileSystem(dataDir, { failFinalDirectorySync: true }),
      ).commit(initial, snapshot('Changed')),
    ).rejects.toBeInstanceOf(PersistenceCommitError);

    expect(await readySnapshot(dataDir)).toEqual(initial);
  });

  it('loads the new state after manifest rename and directory sync succeed', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    const next = snapshot('Changed');
    await backend(dataDir).commit(null, initial);

    await backend(dataDir, faultingFileSystem(dataDir, {})).commit(initial, next);

    expect(await readySnapshot(dataDir)).toEqual(next);
  });

  it('keeps an unconfirmed rollback poisoned and reports the visible manifest', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    const next = snapshot('Changed');
    await backend(dataDir).commit(null, initial);
    const store = backend(
      dataDir,
      faultingFileSystem(dataDir, {
        failFinalDirectorySync: true,
        failRollbackDirectorySync: true,
      }),
    );
    await store.load();

    await expect(store.commit(initial, next)).rejects.toBeInstanceOf(
      PersistenceUncertainCommitError,
    );

    expect(store.status()).toMatchObject({ health: 'error', durable: false, revision: 1 });
    await expect(store.load()).resolves.toMatchObject({
      status: 'ready',
      snapshot: initial,
      persistence: { health: 'error', durable: false, revision: 1 },
    });
    await expect(store.commit(initial, next)).rejects.toBeInstanceOf(
      PersistenceUncertainCommitError,
    );
    expect(await readySnapshot(dataDir)).toEqual(initial);
  });
});

describe('commit resource preflight', () => {
  it('rejects an active log byte overflow before mutating disk', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    const store = backend(dataDir, nodeAtomicFileSystem, { maxActiveLogBytes: 1 });
    await store.commit(null, initial);
    const manifestBefore = await readFile(join(dataDir, 'manifest.json'));
    const logBefore = await readFile(join(dataDir, 'inference-log.jsonl'));
    const nodesBefore = await readdir(join(dataDir, 'conversations'));

    await expect(
      store.commit(initial, snapshot('Initial', [inferenceLog(1)], 1)),
    ).rejects.toBeInstanceOf(PersistenceCommitError);

    expect(await readFile(join(dataDir, 'manifest.json'))).toEqual(manifestBefore);
    expect(await readFile(join(dataDir, 'inference-log.jsonl'))).toEqual(logBefore);
    expect(await readdir(join(dataDir, 'conversations'))).toEqual(nodesBefore);
    expect(await readySnapshot(dataDir)).toEqual(initial);
  });

  it('rejects an active log record-count overflow before mutating disk', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    const store = backend(dataDir, nodeAtomicFileSystem, { maxActiveLogRecords: 1 });
    await store.commit(null, initial);
    const manifestBefore = await readFile(join(dataDir, 'manifest.json'));
    const logBefore = await readFile(join(dataDir, 'inference-log.jsonl'));

    await expect(
      store.commit(
        initial,
        snapshot('Initial', [inferenceLog(1), inferenceLog(2)], 2),
      ),
    ).rejects.toBeInstanceOf(PersistenceCommitError);

    expect(await readFile(join(dataDir, 'manifest.json'))).toEqual(manifestBefore);
    expect(await readFile(join(dataDir, 'inference-log.jsonl'))).toEqual(logBefore);
    expect(await readySnapshot(dataDir)).toEqual(initial);
  });

  it('rejects a projected conversation-envelope overflow before first write', async () => {
    const { dataDir } = await tempDataDirectory();
    const store = backend(dataDir, nodeAtomicFileSystem, {
      maxTotalConversationBytes: 1,
    });

    await expect(store.commit(null, snapshot('Initial'))).rejects.toBeInstanceOf(
      PersistenceCommitError,
    );

    await expect(backend(dataDir).load()).resolves.toMatchObject({ status: 'miss' });
  });

  it('rejects a projected immutable-revision entry overflow without mutation', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    const linkFile = vi.fn(nodeAtomicFileSystem.link);
    const fileSystem: AtomicFileSystem = {
      ...nodeAtomicFileSystem,
      link: linkFile,
    };
    const store = backend(dataDir, fileSystem, {
      maxConversationDirectoryEntries: 2,
    });
    await store.commit(null, initial);
    linkFile.mockClear();
    const manifestBefore = await readFile(join(dataDir, 'manifest.json'));
    const logBefore = await readFile(join(dataDir, 'inference-log.jsonl'));
    const nodesBefore = await readdir(join(dataDir, 'conversations'));

    await expect(store.commit(initial, snapshot('Changed'))).rejects.toBeInstanceOf(
      PersistenceCommitError,
    );

    expect(await readFile(join(dataDir, 'manifest.json'))).toEqual(manifestBefore);
    expect(await readFile(join(dataDir, 'inference-log.jsonl'))).toEqual(logBefore);
    expect(await readdir(join(dataDir, 'conversations'))).toEqual(nodesBefore);
    expect(linkFile).not.toHaveBeenCalled();
    await expect(
      backend(dataDir, nodeAtomicFileSystem, {
        maxConversationDirectoryEntries: 2,
      }).load(),
    ).resolves.toMatchObject({ status: 'ready', snapshot: initial });
  });

  it('rejects resource limits that would raise a production cap', async () => {
    const { dataDir } = await tempDataDirectory();

    expect(() =>
      backend(dataDir, nodeAtomicFileSystem, {
        maxActiveLogRecords: 100_001,
      }),
    ).toThrow(PersistenceConfigurationError);
  });
});

describe('committed corruption boundaries', () => {
  it('returns a typed corruption error without mutating a corrupt committed log prefix', async () => {
    const { dataDir } = await tempDataDirectory();
    await backend(dataDir).commit(null, snapshot('Initial', [inferenceLog(1)], 1));
    const logPath = join(dataDir, 'inference-log.jsonl');
    const corrupted = Buffer.from(await readFile(logPath));
    corrupted[0] = 0x21;
    await writeFile(logPath, corrupted);
    const manifestBefore = await readFile(join(dataDir, 'manifest.json'));

    await expect(backend(dataDir).load()).rejects.toMatchObject({
      name: 'PersistenceCorruptionError',
    });

    expect(await readFile(logPath)).toEqual(corrupted);
    expect(await readFile(join(dataDir, 'manifest.json'))).toEqual(manifestBefore);
  });

  it('returns a typed corruption error for a truncated committed log prefix', async () => {
    const { dataDir } = await tempDataDirectory();
    await backend(dataDir).commit(null, snapshot('Initial', [inferenceLog(1)], 1));
    const logPath = join(dataDir, 'inference-log.jsonl');
    const manifestBefore = await readFile(join(dataDir, 'manifest.json'));
    const size = (await stat(logPath)).size;
    await truncate(logPath, size - 1);
    const logBefore = await readFile(logPath);

    await expect(backend(dataDir).load()).rejects.toMatchObject({
      name: 'PersistenceCorruptionError',
    });

    expect(await readFile(logPath)).toEqual(logBefore);
    expect(await readFile(join(dataDir, 'manifest.json'))).toEqual(manifestBefore);
  });

  it('rejects an active log range above 256 MiB before opening it', async () => {
    const { dataDir } = await tempDataDirectory();
    await backend(dataDir).commit(null, snapshot('Initial'));
    const manifestPath = join(dataDir, 'manifest.json');
    const manifest = await readManifest(dataDir);
    const oversizedRange = 256 * 1024 * 1024 + 1;
    manifest.inferenceLogBytes = oversizedRange;
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    await truncate(join(dataDir, 'inference-log.jsonl'), oversizedRange);
    const open = vi.fn(nodeAtomicFileSystem.open);
    const fileSystem: AtomicFileSystem = { ...nodeAtomicFileSystem, open };

    await expect(backend(dataDir, fileSystem).load()).rejects.toMatchObject({
      name: 'PersistenceLoadError',
      message: 'committed inference log range exceeds safe bounds',
    });

    expect(
      open.mock.calls.some(([path]) => path === join(dataDir, 'inference-log.jsonl')),
    ).toBe(false);
  });

  it('rejects more than 100,000 active inference log records', async () => {
    const { dataDir } = await tempDataDirectory();
    await backend(dataDir).commit(null, snapshot('Initial'));
    const logPath = join(dataDir, 'inference-log.jsonl');
    const logBytes = Buffer.from('{}\n'.repeat(100_001));
    await writeFile(logPath, logBytes);
    const manifest = await readManifest(dataDir);
    manifest.inferenceLogBytes = logBytes.byteLength;
    await writeFile(join(dataDir, 'manifest.json'), `${JSON.stringify(manifest)}\n`);

    await expect(backend(dataDir).load()).rejects.toMatchObject({
      name: 'PersistenceLoadError',
      message: 'committed inference log record count exceeds safe bounds',
    });
  });

  it('rejects more than 256 MiB of committed conversation envelopes before reading them', async () => {
    const { dataDir } = await tempDataDirectory();
    await backend(dataDir).commit(null, snapshot('Initial'));
    const manifest = await readManifest(dataDir);
    const conversationIds = [
      'root',
      ...Array.from({ length: 16 }, (_, index) => `independent-${index + 1}`),
    ];
    manifest.conversations = Object.fromEntries(conversationIds.map((id) => [id, 1]));
    manifest.conversationOrder = conversationIds;
    await writeFile(join(dataDir, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    for (const conversationId of conversationIds.slice(1)) {
      const path = join(dataDir, 'conversations', `${conversationId}.r1.json`);
      await writeFile(path, '', { mode: 0o600 });
      await truncate(path, 16 * 1024 * 1024);
    }
    const open = vi.fn(nodeAtomicFileSystem.open);
    const fileSystem: AtomicFileSystem = { ...nodeAtomicFileSystem, open };

    await expect(backend(dataDir, fileSystem).load()).rejects.toMatchObject({
      name: 'PersistenceLoadError',
      message: 'committed conversation envelope bytes exceed safe bounds',
    });

    expect(
      open.mock.calls.some(([path]) =>
        String(path).includes(`${join(dataDir, 'conversations')}/`),
      ),
    ).toBe(false);
  });

  it('fails a healthy load when bounded conversation-directory iteration is exhausted', async () => {
    const { dataDir } = await tempDataDirectory();
    await backend(dataDir).commit(null, snapshot('Initial'));
    const manifestBefore = await readFile(join(dataDir, 'manifest.json'));
    let index = 0;
    const fakeDirectory = {
      read: async () => ({ name: `unrelated-${index += 1}` }),
      close: async () => undefined,
    } as unknown as Awaited<ReturnType<AtomicFileSystem['opendir']>>;
    const fileSystem = { ...nodeAtomicFileSystem };
    fileSystem.opendir = (async (path, options) => {
      if (String(path) === join(dataDir, 'conversations')) return fakeDirectory;
      return nodeAtomicFileSystem.opendir(path, options);
    }) as AtomicFileSystem['opendir'];

    await expect(backend(dataDir, fileSystem).load()).rejects.toMatchObject({
      name: 'PersistenceLoadError',
    });

    expect(index).toBe(100_001);
    expect(await readFile(join(dataDir, 'manifest.json'))).toEqual(manifestBefore);
  });

  it.each(['manifest', 'conversation', 'inference-log'])(
    'rejects a hard-linked authoritative %s file without recovery mutation',
    async (kind) => {
      const { root, dataDir } = await tempDataDirectory();
      await backend(dataDir).commit(null, snapshot('Initial'));
      const path =
        kind === 'manifest'
          ? join(dataDir, 'manifest.json')
          : kind === 'conversation'
            ? join(dataDir, 'conversations', 'root.r1.json')
            : join(dataDir, 'inference-log.jsonl');
      const alias = join(root, `${kind}.alias`);
      await link(path, alias);
      const bytesBefore = await readFile(path);

      await expect(backend(dataDir).load()).rejects.toMatchObject({
        name: 'PersistenceUnsafePathError',
      });

      expect(await readFile(path)).toEqual(bytesBefore);
      expect(await stat(path)).toMatchObject({ nlink: 2 });
      await expect(readdir(join(dataDir, 'quarantine'))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.each(['data', 'conversations'])(
    'rejects a group-accessible authoritative %s directory without mutation',
    async (kind) => {
      const { dataDir } = await tempDataDirectory();
      await backend(dataDir).commit(null, snapshot('Initial'));
      const directory = kind === 'data' ? dataDir : join(dataDir, 'conversations');
      await chmod(directory, 0o770);
      const manifestBefore = await readFile(join(dataDir, 'manifest.json'));

      await expect(backend(dataDir).load()).rejects.toMatchObject({
        name: 'PersistenceUnsafePathError',
      });

      expect((await stat(directory)).mode & 0o777).toBe(0o770);
      expect(await readFile(join(dataDir, 'manifest.json'))).toEqual(manifestBefore);
    },
  );

  it.each(['manifest', 'conversation', 'inference-log'])(
    'rejects a group-readable authoritative %s file without recovery mutation',
    async (kind) => {
      const { dataDir } = await tempDataDirectory();
      await backend(dataDir).commit(null, snapshot('Initial'));
      const path =
        kind === 'manifest'
          ? join(dataDir, 'manifest.json')
          : kind === 'conversation'
            ? join(dataDir, 'conversations', 'root.r1.json')
            : join(dataDir, 'inference-log.jsonl');
      await chmod(path, 0o640);
      const bytesBefore = await readFile(path);

      await expect(backend(dataDir).load()).rejects.toMatchObject({
        name: 'PersistenceUnsafePathError',
      });

      expect(await readFile(path)).toEqual(bytesBefore);
      expect((await stat(path)).mode & 0o777).toBe(0o640);
      await expect(readdir(join(dataDir, 'quarantine'))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('rejects a future conversation schema without mutating persistence', async () => {
    const { dataDir } = await tempDataDirectory();
    await backend(dataDir).commit(null, snapshot('Initial'));
    const nodePath = join(dataDir, 'conversations', 'root.r1.json');
    const envelope = JSON.parse(await readFile(nodePath, 'utf8')) as Record<string, unknown>;
    envelope.schemaVersion = 2;
    await writeFile(nodePath, `${JSON.stringify(envelope)}\n`);
    const manifestBefore = await readFile(join(dataDir, 'manifest.json'));
    const nodeBefore = await readFile(nodePath);

    await expect(backend(dataDir).load()).rejects.toMatchObject({
      name: 'PersistenceUnsupportedSchemaError',
    });

    expect(await readFile(join(dataDir, 'manifest.json'))).toEqual(manifestBefore);
    expect(await readFile(nodePath)).toEqual(nodeBefore);
    await expect(readdir(join(dataDir, 'quarantine'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('conversation recovery', () => {
  it('repairs a corrupt current node from the highest valid prior revision', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    const changed = snapshot('Changed');
    await backend(dataDir).commit(null, initial);
    await backend(dataDir).commit(initial, changed);
    const corruptPath = join(dataDir, 'conversations', 'root.r2.json');
    const corruptBytes = Buffer.from('{"schemaVersion":1,"broken":\xff}\n', 'latin1');
    await writeFile(corruptPath, corruptBytes);

    const loaded = await backend(dataDir).load();

    expect(loaded.status).toBe('degraded');
    if (loaded.status !== 'degraded') throw new Error('expected degraded recovery');
    expect(loaded.snapshot).toEqual(initial);
    expect(loaded.persistence).toMatchObject({
      health: 'degraded',
      durable: true,
      revision: 3,
      recoveredConversationIds: ['root'],
    });
    expect(await readManifest(dataDir)).toMatchObject({
      revision: 3,
      conversations: { root: 1 },
      conversationOrder: ['root'],
    });
    const quarantineDirectory = join(dataDir, 'quarantine');
    const quarantined = await readdir(quarantineDirectory);
    expect(quarantined).toHaveLength(1);
    expect(await readFile(join(quarantineDirectory, quarantined[0]))).toEqual(corruptBytes);
    expect((await stat(join(quarantineDirectory, quarantined[0]))).mode & 0o777).toBe(0o600);
    expect(await exists(corruptPath)).toBe(false);

    const restarted = await backend(dataDir).load();
    expect(restarted).toMatchObject({ status: 'ready', snapshot: initial });
  });

  it('recovers a current node with a malformed schema version', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    const changed = snapshot('Changed');
    await backend(dataDir).commit(null, initial);
    await backend(dataDir).commit(initial, changed);
    const currentPath = join(dataDir, 'conversations', 'root.r2.json');
    const envelope = JSON.parse(await readFile(currentPath, 'utf8')) as Record<
      string,
      unknown
    >;
    delete envelope.schemaVersion;
    await writeFile(currentPath, `${JSON.stringify(envelope)}\n`);

    await expect(backend(dataDir).load()).resolves.toMatchObject({
      status: 'degraded',
      snapshot: initial,
      persistence: { recoveredConversationIds: ['root'] },
    });
  });

  it('skips an invalid nearer prior revision and quarantines only the corrupt current file', async () => {
    const { dataDir } = await tempDataDirectory();
    const first = snapshot('First');
    const second = snapshot('Second');
    const third = snapshot('Third');
    await backend(dataDir).commit(null, first);
    await backend(dataDir).commit(first, second);
    await backend(dataDir).commit(second, third);
    const nearerPath = join(dataDir, 'conversations', 'root.r2.json');
    const currentPath = join(dataDir, 'conversations', 'root.r3.json');
    const nearerBytes = Buffer.from('invalid-nearer\n');
    const currentBytes = Buffer.from('invalid-current\n');
    await writeFile(nearerPath, nearerBytes);
    await writeFile(currentPath, currentBytes);

    const loaded = await backend(dataDir).load();

    expect(loaded).toMatchObject({
      status: 'degraded',
      snapshot: first,
      persistence: { revision: 4, recoveredConversationIds: ['root'] },
    });
    expect(await readManifest(dataDir)).toMatchObject({ revision: 4, conversations: { root: 1 } });
    expect(await readFile(nearerPath)).toEqual(nearerBytes);
    expect(await exists(currentPath)).toBe(false);
    const quarantined = await readdir(join(dataDir, 'quarantine'));
    expect(quarantined).toHaveLength(1);
    expect(await readFile(join(dataDir, 'quarantine', quarantined[0]))).toEqual(currentBytes);
  });

  it('never recovers from a valid higher orphan revision', async () => {
    const { dataDir } = await tempDataDirectory();
    const first = snapshot('First');
    const second = snapshot('Second');
    const orphan = snapshot('Uncommitted higher orphan');
    await backend(dataDir).commit(null, first);
    await backend(dataDir).commit(first, second);
    await expect(
      backend(dataDir, faultingFileSystem(dataDir, { beforeManifestRename: true })).commit(
        second,
        orphan,
      ),
    ).rejects.toBeInstanceOf(PersistenceCommitError);
    await writeFile(join(dataDir, 'conversations', 'root.r2.json'), 'invalid-current\n');

    const loaded = await backend(dataDir).load();

    expect(loaded).toMatchObject({
      status: 'degraded',
      snapshot: first,
      persistence: { revision: 4, recoveredConversationIds: ['root'] },
    });
    expect(await readManifest(dataDir)).toMatchObject({ revision: 4, conversations: { root: 1 } });
    expect(await readFile(join(dataDir, 'conversations', 'root.r3.json'), 'utf8')).toContain(
      'Uncommitted higher orphan',
    );
  });

  it('rejects more than 128 prior recovery candidates without mutation', async () => {
    const { dataDir } = await tempDataDirectory();
    await backend(dataDir).commit(null, snapshot('Initial'));
    const manifestPath = join(dataDir, 'manifest.json');
    const manifest = await readManifest(dataDir);
    manifest.revision = 130;
    manifest.conversations = { root: 130 };
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    const currentPath = join(dataDir, 'conversations', 'root.r130.json');
    await writeFile(currentPath, 'invalid-current\n', { mode: 0o600 });
    for (let revision = 2; revision < 130; revision += 1) {
      await writeFile(
        join(dataDir, 'conversations', `root.r${revision}.json`),
        'invalid-prior\n',
        { mode: 0o600 },
      );
    }
    const manifestBefore = await readFile(manifestPath);
    const currentBefore = await readFile(currentPath);

    await expect(backend(dataDir).load()).rejects.toMatchObject({
      name: 'PersistenceRecoveryError',
    });

    expect(await readFile(manifestPath)).toEqual(manifestBefore);
    expect(await readFile(currentPath)).toEqual(currentBefore);
    await expect(readdir(join(dataDir, 'quarantine'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stops bounded directory iteration after 100,000 entries without mutation', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    const changed = snapshot('Changed');
    await backend(dataDir).commit(null, initial);
    await backend(dataDir).commit(initial, changed);
    const manifestPath = join(dataDir, 'manifest.json');
    const currentPath = join(dataDir, 'conversations', 'root.r2.json');
    await writeFile(currentPath, 'invalid-current\n');
    const manifestBefore = await readFile(manifestPath);
    let index = 0;
    const fakeDirectory = {
      read: async () => ({ name: `unrelated-${index += 1}` }),
      close: async () => undefined,
    } as unknown as Awaited<ReturnType<AtomicFileSystem['opendir']>>;
    const fileSystem = { ...nodeAtomicFileSystem };
    fileSystem.opendir = (async (path, options) => {
      if (String(path) === join(dataDir, 'conversations')) return fakeDirectory;
      return nodeAtomicFileSystem.opendir(path, options);
    }) as AtomicFileSystem['opendir'];

    await expect(backend(dataDir, fileSystem).load()).rejects.toMatchObject({
      name: 'PersistenceLoadError',
    });

    expect(index).toBe(100_001);
    expect(await readFile(manifestPath)).toEqual(manifestBefore);
    expect(await readFile(currentPath, 'utf8')).toBe('invalid-current\n');
  });

  it('does not mutate a corrupt first revision when no valid predecessor exists', async () => {
    const { dataDir } = await tempDataDirectory();
    await backend(dataDir).commit(null, snapshot('Initial'));
    const manifestPath = join(dataDir, 'manifest.json');
    const corruptPath = join(dataDir, 'conversations', 'root.r1.json');
    await writeFile(corruptPath, 'invalid-first\n');
    const manifestBefore = await readFile(manifestPath);
    const corruptBefore = await readFile(corruptPath);

    await expect(backend(dataDir).load()).rejects.toMatchObject({
      name: 'PersistenceCorruptionError',
    });

    expect(await readFile(manifestPath)).toEqual(manifestBefore);
    expect(await readFile(corruptPath)).toEqual(corruptBefore);
    await expect(readdir(join(dataDir, 'quarantine'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not recover or mutate a missing current revision', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    const changed = snapshot('Changed');
    await backend(dataDir).commit(null, initial);
    await backend(dataDir).commit(initial, changed);
    const manifestPath = join(dataDir, 'manifest.json');
    const currentPath = join(dataDir, 'conversations', 'root.r2.json');
    const manifestBefore = await readFile(manifestPath);
    await rm(currentPath);

    await expect(backend(dataDir).load()).rejects.toMatchObject({
      name: 'PersistenceLoadError',
    });

    expect(await readFile(manifestPath)).toEqual(manifestBefore);
    expect(await exists(currentPath)).toBe(false);
    await expect(readdir(join(dataDir, 'quarantine'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails without repairing when the quarantine directory is a symlink', async () => {
    const { root, dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    const changed = snapshot('Changed');
    await backend(dataDir).commit(null, initial);
    await backend(dataDir).commit(initial, changed);
    const currentPath = join(dataDir, 'conversations', 'root.r2.json');
    await writeFile(currentPath, 'invalid-current\n');
    const manifestPath = join(dataDir, 'manifest.json');
    const manifestBefore = await readFile(manifestPath);
    const currentBefore = await readFile(currentPath);
    const outside = join(root, 'outside-quarantine');
    await mkdir(outside);
    await symlink(outside, join(dataDir, 'quarantine'));

    await expect(backend(dataDir).load()).rejects.toMatchObject({
      name: 'PersistenceRecoveryError',
    });

    expect(await readFile(manifestPath)).toEqual(manifestBefore);
    expect(await readFile(currentPath)).toEqual(currentBefore);
    expect(await readdir(outside)).toEqual([]);
  });

  it('keeps the old manifest and corrupt source when quarantine sync fails', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    const changed = snapshot('Changed');
    await backend(dataDir).commit(null, initial);
    await backend(dataDir).commit(initial, changed);
    const manifestPath = join(dataDir, 'manifest.json');
    const currentPath = join(dataDir, 'conversations', 'root.r2.json');
    await writeFile(currentPath, 'invalid-current\n');
    const manifestBefore = await readFile(manifestPath);
    const currentBefore = await readFile(currentPath);

    await expect(
      backend(
        dataDir,
        faultingFileSystem(dataDir, { failQuarantineDirectorySync: true }),
      ).load(),
    ).rejects.toMatchObject({ name: 'PersistenceRecoveryError' });

    expect(await readFile(manifestPath)).toEqual(manifestBefore);
    expect(await readFile(currentPath)).toEqual(currentBefore);
  });

  it('keeps the old manifest and corrupt source when repaired manifest publication fails', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    const changed = snapshot('Changed');
    await backend(dataDir).commit(null, initial);
    await backend(dataDir).commit(initial, changed);
    const manifestPath = join(dataDir, 'manifest.json');
    const currentPath = join(dataDir, 'conversations', 'root.r2.json');
    await writeFile(currentPath, 'invalid-current\n');
    const manifestBefore = await readFile(manifestPath);
    const currentBefore = await readFile(currentPath);

    await expect(
      backend(
        dataDir,
        faultingFileSystem(dataDir, { beforeManifestRename: true }),
      ).load(),
    ).rejects.toMatchObject({ name: 'PersistenceRecoveryError' });

    expect(await readFile(manifestPath)).toEqual(manifestBefore);
    expect(await readFile(currentPath)).toEqual(currentBefore);
  });

  it('does not recurse into recovery after an unconfirmed repair rollback', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    const changed = snapshot('Changed');
    await backend(dataDir).commit(null, initial);
    await backend(dataDir).commit(initial, changed);
    const currentPath = join(dataDir, 'conversations', 'root.r2.json');
    await writeFile(currentPath, 'invalid-current\n');
    const store = backend(
      dataDir,
      faultingFileSystem(dataDir, {
        failFinalDirectorySync: true,
        failRollbackDirectorySync: true,
      }),
    );

    await expect(store.load()).rejects.toBeInstanceOf(PersistenceUncertainCommitError);

    expect(store.status()).toMatchObject({ health: 'error', durable: false, revision: 2 });
    await expect(store.load()).rejects.toMatchObject({ name: 'PersistenceCorruptionError' });
    expect(store.status()).toMatchObject({ health: 'error', durable: false, revision: 2 });
    await expect(store.commit(changed, snapshot('Another'))).rejects.toBeInstanceOf(
      PersistenceUncertainCommitError,
    );
    await expect(backend(dataDir).load()).resolves.toMatchObject({
      status: 'degraded',
      snapshot: initial,
    });
  });

  it('keeps a repaired manifest authoritative when corrupt-source cleanup fails', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot('Initial');
    const changed = snapshot('Changed');
    await backend(dataDir).commit(null, initial);
    await backend(dataDir).commit(initial, changed);
    const currentPath = join(dataDir, 'conversations', 'root.r2.json');
    await writeFile(currentPath, 'invalid-current\n');

    const loaded = await backend(
      dataDir,
      faultingFileSystem(dataDir, { failRecoveredSourceUnlink: true }),
    ).load();

    expect(loaded).toMatchObject({
      status: 'degraded',
      snapshot: initial,
      persistence: {
        revision: 3,
        message: 'recovered conversations; corrupt source cleanup requires attention',
      },
    });
    expect(await readManifest(dataDir)).toMatchObject({ revision: 3, conversations: { root: 1 } });
    expect(await exists(currentPath)).toBe(true);
    await expect(backend(dataDir).load()).resolves.toMatchObject({
      status: 'ready',
      snapshot: initial,
    });
  });
});

describe('stale temporary file cleanup', () => {
  it('removes only old writer-owned temp files without following links', async () => {
    const { root, dataDir } = await tempDataDirectory();
    await backend(dataDir).commit(null, snapshot('Initial'));
    const conversations = join(dataDir, 'conversations');
    const quarantine = join(dataDir, 'quarantine');
    await mkdir(quarantine, { mode: 0o700 });
    const uuid = '11111111-1111-4111-8111-111111111111';
    const oldManifestTemp = join(dataDir, `.manifest.json.999991.${uuid}.tmp`);
    const oldNodeTemp = join(conversations, `.root.r2.json.999991.${uuid}.tmp`);
    const currentPidTemp = join(
      dataDir,
      `.manifest.json.${process.pid}.${uuid}.tmp`,
    );
    const youngTemp = join(dataDir, `.manifest.json.999992.${uuid}.tmp`);
    const linkedTemp = join(dataDir, `.manifest.json.999993.${uuid}.tmp`);
    const linkedTarget = join(root, 'linked-temp-target');
    const symlinkTemp = join(conversations, `.root.r2.json.999994.${uuid}.tmp`);
    const symlinkTarget = join(root, 'symlink-temp-target');
    const unrelated = join(dataDir, '.not-a-writer-temp.tmp');
    const quarantineEvidence = join(
      quarantine,
      `root.r2.json.${uuid}.corrupt`,
    );
    const oldQuarantineTemp = join(
      quarantine,
      `.root.r2.json.${uuid}.corrupt.999995.${uuid}.tmp`,
    );
    const unrelatedQuarantineTemp = join(quarantine, '.unrelated.999995.tmp');
    for (const path of [
      oldManifestTemp,
      oldNodeTemp,
      currentPidTemp,
      youngTemp,
      linkedTarget,
      symlinkTarget,
      unrelated,
      quarantineEvidence,
      oldQuarantineTemp,
      unrelatedQuarantineTemp,
    ]) {
      await writeFile(path, basename(path), { mode: 0o600 });
    }
    await link(linkedTarget, linkedTemp);
    await symlink(symlinkTarget, symlinkTemp);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    for (const path of [
      oldManifestTemp,
      oldNodeTemp,
      currentPidTemp,
      linkedTemp,
      symlinkTarget,
      oldQuarantineTemp,
    ]) {
      await utimes(path, old, old);
    }

    await expect(backend(dataDir).load()).resolves.toMatchObject({ status: 'ready' });

    expect(await exists(oldManifestTemp)).toBe(false);
    expect(await exists(oldNodeTemp)).toBe(false);
    expect(await exists(oldQuarantineTemp)).toBe(false);
    for (const path of [
      currentPidTemp,
      youngTemp,
      linkedTemp,
      linkedTarget,
      symlinkTemp,
      symlinkTarget,
      unrelated,
      quarantineEvidence,
      unrelatedQuarantineTemp,
    ]) {
      expect(await exists(path)).toBe(true);
    }
    expect(await readFile(linkedTarget, 'utf8')).toBe(basename(linkedTarget));
    expect(await readFile(symlinkTarget, 'utf8')).toBe(basename(symlinkTarget));
  });
});
