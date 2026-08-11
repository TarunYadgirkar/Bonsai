import {
  access,
  appendFile,
  chmod,
  copyFile,
  link,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreSnapshot } from '../store-schema';
import type { Conversation, InferenceLog } from '../types';
import {
  PersistenceCommitError,
  PersistenceConfigurationError,
  PersistenceConflictError,
  PersistenceLoadError,
  PersistenceSchemaError,
  PersistenceUncertainCommitError,
} from './errors';
import {
  AtomicDestinationExistsError,
  nodeAtomicFileSystem,
  writeAtomicFile,
} from './atomic-file';
import type { AtomicFileSystem } from './atomic-file';
import { FilePersistenceBackend, resolveFileDataDirectory } from './file';
import { parseConversationEnvelopeV1, parseManifestV1 } from './schema';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempDataDirectory(): Promise<{ root: string; dataDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'bonsai-file-test-'));
  tempRoots.push(root);
  return { root, dataDir: join(root, 'state') };
}

function backend(
  dataDir: string,
  fileSystem: AtomicFileSystem = nodeAtomicFileSystem,
): FilePersistenceBackend {
  return new FilePersistenceBackend({
    cwd: '/unused',
    env: { NODE_ENV: 'test', BONSAI_DATA_DIR: dataDir },
    fileSystem,
  });
}

function failDataDirectorySyncs(dataDir: string): AtomicFileSystem {
  const fileSystem = { ...nodeAtomicFileSystem };
  fileSystem.open = (async (path: string, flags: string | number, mode?: number) => {
    const handle = await nodeAtomicFileSystem.open(path, flags, mode);
    if (path !== dataDir) return handle;
    return new Proxy(handle, {
      get(target, property) {
        if (property === 'sync') {
          return async () => {
            throw new Error('injected directory sync failure');
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }) as AtomicFileSystem['open'];
  return fileSystem;
}

function rootConversation(id: string, title = id): Conversation {
  return {
    id,
    title,
    parentId: null,
    messages: [],
    insights: [],
    pinnedTier: null,
    archived: false,
  };
}

function inferenceLog(sequence: number, branchId = 'root'): InferenceLog {
  return {
    id: `log_${sequence}`,
    ts: `2026-08-11T00:00:0${sequence}.000Z`,
    branchId,
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
  conversations: Conversation[] = [rootConversation('root')],
  logs: InferenceLog[] = [],
  seq = logs.length,
): StoreSnapshot {
  return { conversations, logs, rootId: conversations[0].id, seq };
}

function logLine(log: InferenceLog): string {
  return `${JSON.stringify(log)}\n`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(dataDir: string) {
  return parseManifestV1(JSON.parse(await readFile(join(dataDir, 'manifest.json'), 'utf8')));
}

describe('FilePersistenceBackend', () => {
  it('returns a miss without creating the data directory', async () => {
    const { dataDir } = await tempDataDirectory();
    const store = backend(dataDir);

    await expect(store.load()).resolves.toEqual({
      status: 'miss',
      persistence: { backend: 'file', health: 'ready', durable: true, revision: null },
    });
    expect(store.status()).toEqual({
      backend: 'file',
      health: 'ready',
      durable: true,
      revision: null,
    });
    expect(await exists(dataDir)).toBe(false);
  });

  it('validates the complete snapshot before creating or writing files', async () => {
    const { root, dataDir } = await tempDataDirectory();
    const invalid = {
      conversations: [rootConversation('../escape')],
      logs: [],
      rootId: '../escape',
      seq: 0,
    } as StoreSnapshot;

    await expect(backend(dataDir).commit(null, invalid)).rejects.toBeInstanceOf(
      PersistenceSchemaError,
    );
    expect(await readdir(root)).toEqual([]);
  });

  it('creates a V1 manifest, immutable node revisions, and JSONL with private modes', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot([rootConversation('root')], [inferenceLog(1)], 1);

    await expect(backend(dataDir).commit(null, initial)).resolves.toEqual({
      backend: 'file',
      health: 'ready',
      durable: true,
      revision: 1,
    });

    const manifest = await readManifest(dataDir);
    expect(manifest).toEqual({
      schemaVersion: 1,
      revision: 1,
      rootId: 'root',
      seq: 1,
      conversations: { root: 1 },
      conversationOrder: ['root'],
      inferenceLogStartBytes: 0,
      inferenceLogBytes: Buffer.byteLength(logLine(initial.logs[0])),
    });
    const nodePath = join(dataDir, 'conversations', 'root.r1.json');
    const envelope = parseConversationEnvelopeV1(
      JSON.parse(await readFile(nodePath, 'utf8')),
      'root.r1.json',
    );
    expect(envelope.conversation).toEqual(initial.conversations[0]);
    expect(await readFile(join(dataDir, 'inference-log.jsonl'), 'utf8')).toBe(
      logLine(initial.logs[0]),
    );
    await expect(readdir(join(dataDir, 'conversations'))).resolves.toEqual(['root.r1.json']);
    for (const path of [join(dataDir, 'manifest.json'), nodePath, join(dataDir, 'inference-log.jsonl')]) {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  it('writes new global-revision files only for changed conversations', async () => {
    const { dataDir } = await tempDataDirectory();
    const store = backend(dataDir);
    const initial = snapshot([rootConversation('root'), rootConversation('other')]);
    await store.commit(null, initial);
    const originalRoot = await readFile(join(dataDir, 'conversations', 'root.r1.json'), 'utf8');
    const next = snapshot([rootConversation('root', 'Renamed root'), rootConversation('other')]);

    await store.commit(initial, next);

    expect(await readManifest(dataDir)).toMatchObject({
      revision: 2,
      conversations: { root: 2, other: 1 },
    });
    expect(await readdir(join(dataDir, 'conversations'))).toEqual([
      'other.r1.json',
      'root.r1.json',
      'root.r2.json',
    ]);
    expect(await readFile(join(dataDir, 'conversations', 'root.r1.json'), 'utf8')).toBe(
      originalRoot,
    );
    expect((await stat(join(dataDir, 'conversations', 'root.r2.json'))).nlink).toBe(1);
  });

  it('rejects hard-linked authoritative files before a commit', async () => {
    const { root, dataDir } = await tempDataDirectory();
    const store = backend(dataDir);
    const initial = snapshot([rootConversation('root')]);
    await store.commit(null, initial);
    const manifestPath = join(dataDir, 'manifest.json');
    const nodePath = join(dataDir, 'conversations', 'root.r1.json');
    const linkedManifest = join(root, 'linked-manifest.json');
    const linkedNode = join(root, 'linked-node.json');
    const originalManifest = await readFile(manifestPath, 'utf8');
    const originalNode = await readFile(nodePath, 'utf8');
    await link(manifestPath, linkedManifest);
    await link(nodePath, linkedNode);

    await expect(
      store.commit(initial, snapshot([rootConversation('root', 'Changed')])),
    ).rejects.toBeInstanceOf(PersistenceCommitError);

    expect(await readFile(linkedManifest, 'utf8')).toBe(originalManifest);
    expect(await readFile(linkedNode, 'utf8')).toBe(originalNode);
    expect(await readFile(manifestPath, 'utf8')).toBe(originalManifest);
    expect(await readFile(nodePath, 'utf8')).toBe(originalNode);
    expect((await stat(manifestPath)).nlink).toBe(2);
    expect((await stat(nodePath)).nlink).toBe(2);
  });

  it('removes reset conversations from the manifest but preserves old revisions', async () => {
    const { dataDir } = await tempDataDirectory();
    const store = backend(dataDir);
    const initial = snapshot([rootConversation('root'), rootConversation('other')]);
    await store.commit(null, initial);
    const next = snapshot([rootConversation('root')]);

    await store.commit(initial, next);

    expect(await readManifest(dataDir)).toMatchObject({ revision: 2, conversations: { root: 1 } });
    expect(await exists(join(dataDir, 'conversations', 'other.r1.json'))).toBe(true);
  });

  it('appends only new inference events and reloads an equivalent snapshot', async () => {
    const { dataDir } = await tempDataDirectory();
    const store = backend(dataDir);
    const firstLog = inferenceLog(1);
    const secondLog = inferenceLog(2);
    const initial = snapshot([rootConversation('root')], [firstLog], 1);
    await store.commit(null, initial);
    const next = snapshot([rootConversation('root')], [firstLog, secondLog], 2);

    await store.commit(initial, next);

    const expectedJsonl = `${logLine(firstLog)}${logLine(secondLog)}`;
    expect(await readFile(join(dataDir, 'inference-log.jsonl'), 'utf8')).toBe(expectedJsonl);
    expect(await readManifest(dataDir)).toMatchObject({
      inferenceLogStartBytes: 0,
      inferenceLogBytes: Buffer.byteLength(expectedJsonl),
    });
    const loaded = await backend(dataDir).load();
    expect(loaded).toEqual({
      status: 'ready',
      snapshot: next,
      persistence: { backend: 'file', health: 'ready', durable: true, revision: 2 },
    });
  });

  it('preserves conversation order when IDs are integer-like object keys', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot([rootConversation('10'), rootConversation('2')]);
    await backend(dataDir).commit(null, initial);

    const loaded = await backend(dataDir).load();

    expect(loaded.status).toBe('ready');
    if (loaded.status !== 'ready') throw new Error('expected ready persistence');
    expect(loaded.snapshot.conversations.map(({ id }) => id)).toEqual(['10', '2']);
  });

  it.each([
    ['changed', [inferenceLog(2)]],
    ['shorter', []],
  ])('rejects a %s non-prefix log view without rewriting disk', async (_name, logs) => {
    const { dataDir } = await tempDataDirectory();
    const store = backend(dataDir);
    const initial = snapshot([rootConversation('root')], [inferenceLog(1)], 1);
    await store.commit(null, initial);
    const manifestBefore = await readFile(join(dataDir, 'manifest.json'), 'utf8');
    const logBefore = await readFile(join(dataDir, 'inference-log.jsonl'), 'utf8');
    const next = snapshot([rootConversation('root')], logs, logs.length ? 2 : 1);

    await expect(store.commit(initial, next)).rejects.toBeInstanceOf(PersistenceCommitError);

    expect(await readFile(join(dataDir, 'manifest.json'), 'utf8')).toBe(manifestBefore);
    expect(await readFile(join(dataDir, 'inference-log.jsonl'), 'utf8')).toBe(logBefore);
  });

  it('starts a new append-only log epoch when replacement is explicit', async () => {
    const { dataDir } = await tempDataDirectory();
    const store = backend(dataDir);
    const first = inferenceLog(1);
    const second = inferenceLog(2);
    const third = inferenceLog(3);
    const fourth = inferenceLog(4);
    const initial = snapshot([rootConversation('root')], [first, second], 2);
    await store.commit(null, initial);
    const replacement = snapshot([rootConversation('root')], [third], 3);

    await store.commit(initial, replacement, { replaceInferenceLogView: true });

    const firstEpoch = `${logLine(first)}${logLine(second)}`;
    expect(await readFile(join(dataDir, 'inference-log.jsonl'), 'utf8')).toBe(
      `${firstEpoch}${logLine(third)}`,
    );
    expect(await readManifest(dataDir)).toMatchObject({
      inferenceLogStartBytes: Buffer.byteLength(firstEpoch),
      inferenceLogBytes: Buffer.byteLength(logLine(third)),
    });
    await store.commit(
      replacement,
      snapshot([rootConversation('root')], [third, fourth], 4),
    );
    expect(await readFile(join(dataDir, 'inference-log.jsonl'), 'utf8')).toBe(
      `${firstEpoch}${logLine(third)}${logLine(fourth)}`,
    );
    const loaded = await backend(dataDir).load();
    expect(loaded.status).toBe('ready');
    if (loaded.status !== 'ready') throw new Error('expected ready persistence');
    expect(loaded.snapshot.logs).toEqual([third, fourth]);
  });

  it('truncates an uncommitted JSONL suffix before appending', async () => {
    const { dataDir } = await tempDataDirectory();
    const store = backend(dataDir);
    const first = inferenceLog(1);
    const second = inferenceLog(2);
    const initial = snapshot([rootConversation('root')], [first], 1);
    await store.commit(null, initial);
    await appendFile(join(dataDir, 'inference-log.jsonl'), 'uncommitted-suffix', 'utf8');

    await store.commit(initial, snapshot([rootConversation('root')], [first, second], 2));

    expect(await readFile(join(dataDir, 'inference-log.jsonl'), 'utf8')).toBe(
      `${logLine(first)}${logLine(second)}`,
    );
  });

  it('reads only the committed JSONL range through a file handle', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot([rootConversation('root')], [inferenceLog(1)], 1);
    await backend(dataDir).commit(null, initial);
    const logPath = join(dataDir, 'inference-log.jsonl');
    await appendFile(logPath, 'ignored-suffix', 'utf8');
    const openSpy = vi.spyOn(nodeAtomicFileSystem, 'open');
    try {
      await expect(backend(dataDir).load()).resolves.toMatchObject({
        status: 'ready',
        snapshot: initial,
      });
      expect(openSpy.mock.calls.some(([path]) => path === logPath)).toBe(true);
    } finally {
      openSpy.mockRestore();
    }
  });

  it('rejects a stale expected manifest revision before writing', async () => {
    const { dataDir } = await tempDataDirectory();
    const firstBackend = backend(dataDir);
    const staleBackend = backend(dataDir);
    const initial = snapshot([rootConversation('root')]);
    await firstBackend.commit(null, initial);
    await staleBackend.load();
    const committed = snapshot([rootConversation('root', 'First writer')]);
    await firstBackend.commit(initial, committed);
    const manifestBefore = await readFile(join(dataDir, 'manifest.json'), 'utf8');

    await expect(
      staleBackend.commit(initial, snapshot([rootConversation('root', 'Stale writer')])),
    ).rejects.toBeInstanceOf(PersistenceConflictError);
    expect(await readFile(join(dataDir, 'manifest.json'), 'utf8')).toBe(manifestBefore);
  });

  it('allocates above an orphan immutable revision instead of overwriting it', async () => {
    const { dataDir } = await tempDataDirectory();
    const store = backend(dataDir);
    const initial = snapshot([rootConversation('root')]);
    await store.commit(null, initial);
    const orphanPath = join(dataDir, 'conversations', 'root.r2.json');
    const orphan = `${JSON.stringify({
      schemaVersion: 1,
      conversationId: 'root',
      revision: 2,
      conversation: rootConversation('root', 'Interrupted write'),
    })}\n`;
    await writeFile(orphanPath, orphan, { mode: 0o600 });

    await store.commit(initial, snapshot([rootConversation('root', 'Retried write')]));

    expect(await readFile(orphanPath, 'utf8')).toBe(orphan);
    expect(await readManifest(dataDir)).toMatchObject({
      revision: 3,
      conversations: { root: 3 },
    });
  });

  it('rejects a symlinked data directory without writing through it', async () => {
    const { root, dataDir } = await tempDataDirectory();
    const outside = join(root, 'outside-data');
    await mkdir(outside);
    await symlink(outside, dataDir);

    await expect(backend(dataDir).commit(null, snapshot())).rejects.toBeInstanceOf(
      PersistenceCommitError,
    );
    expect(await readdir(outside)).toEqual([]);
  });

  it('rejects a symlinked conversations directory without writing through it', async () => {
    const { root, dataDir } = await tempDataDirectory();
    const outside = join(root, 'outside-conversations');
    await mkdir(dataDir);
    await mkdir(outside);
    await symlink(outside, join(dataDir, 'conversations'));

    await expect(backend(dataDir).commit(null, snapshot())).rejects.toBeInstanceOf(
      PersistenceCommitError,
    );
    expect(await readdir(outside)).toEqual([]);
  });

  it('rejects a symlinked inference log without mutating its target', async () => {
    const { root, dataDir } = await tempDataDirectory();
    const outside = join(root, 'outside-log');
    await mkdir(join(dataDir, 'conversations'), { recursive: true });
    await writeFile(outside, 'must-survive');
    await symlink(outside, join(dataDir, 'inference-log.jsonl'));

    await expect(backend(dataDir).commit(null, snapshot())).rejects.toBeInstanceOf(
      PersistenceCommitError,
    );
    expect(await readFile(outside, 'utf8')).toBe('must-survive');
  });

  it('rejects a hard-linked inference log without mutating its target', async () => {
    const { root, dataDir } = await tempDataDirectory();
    const outside = join(root, 'outside-hard-link');
    await mkdir(join(dataDir, 'conversations'), { recursive: true });
    await writeFile(outside, 'must-survive');
    await link(outside, join(dataDir, 'inference-log.jsonl'));

    await expect(backend(dataDir).commit(null, snapshot())).rejects.toBeInstanceOf(
      PersistenceCommitError,
    );
    expect(await readFile(outside, 'utf8')).toBe('must-survive');
  });

  it.each(['manifest', 'conversation'])('rejects a symlinked %s file on load', async (kind) => {
    const { root, dataDir } = await tempDataDirectory();
    await backend(dataDir).commit(null, snapshot());
    const path =
      kind === 'manifest'
        ? join(dataDir, 'manifest.json')
        : join(dataDir, 'conversations', 'root.r1.json');
    const outside = join(root, `outside-${kind}.json`);
    await copyFile(path, outside);
    await rm(path);
    await symlink(outside, path);

    await expect(backend(dataDir).load()).rejects.toBeInstanceOf(PersistenceLoadError);
  });

  it.each([
    ['manifest', 8 * 1024 * 1024 + 1, (dataDir: string) => join(dataDir, 'manifest.json')],
    [
      'conversation',
      16 * 1024 * 1024 + 1,
      (dataDir: string) => join(dataDir, 'conversations', 'root.r1.json'),
    ],
  ])('rejects an oversized %s before allocating its contents', async (_kind, size, pathFor) => {
    const { dataDir } = await tempDataDirectory();
    await backend(dataDir).commit(null, snapshot());
    await truncate(pathFor(dataDir), size);

    await expect(backend(dataDir).load()).rejects.toBeInstanceOf(PersistenceLoadError);
  });

  it('rejects an oversized inference record before creating the data directory', async () => {
    const { root, dataDir } = await tempDataDirectory();
    const oversized = { ...inferenceLog(1), model: 'x'.repeat(1024 * 1024) };

    await expect(
      backend(dataDir).commit(null, snapshot([rootConversation('root')], [oversized], 1)),
    ).rejects.toBeInstanceOf(PersistenceCommitError);
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects an oversized persisted inference record while streaming the active range', async () => {
    const { dataDir } = await tempDataDirectory();
    await backend(dataDir).commit(null, snapshot());
    const oversized = { ...inferenceLog(1), model: 'x'.repeat(1024 * 1024) };
    const line = logLine(oversized);
    await writeFile(join(dataDir, 'inference-log.jsonl'), line, { mode: 0o600 });
    const manifest = await readManifest(dataDir);
    manifest.inferenceLogBytes = Buffer.byteLength(line);
    manifest.seq = 1;
    await writeFile(join(dataDir, 'manifest.json'), `${JSON.stringify(manifest)}\n`, {
      mode: 0o600,
    });

    await expect(backend(dataDir).load()).rejects.toBeInstanceOf(PersistenceLoadError);
  });

  it('hardens pre-existing persistence directories to private modes', async () => {
    const { dataDir } = await tempDataDirectory();
    const conversations = join(dataDir, 'conversations');
    await mkdir(conversations, { recursive: true });
    await chmod(dataDir, 0o777);
    await chmod(conversations, 0o777);

    await backend(dataDir).commit(null, snapshot());

    expect((await stat(dataDir)).mode & 0o777).toBe(0o700);
    expect((await stat(conversations)).mode & 0o777).toBe(0o700);
  });

  it('keeps an uncertain backend poisoned while reloading the visible manifest', async () => {
    const { dataDir } = await tempDataDirectory();
    const initial = snapshot([rootConversation('root')]);
    await backend(dataDir).commit(null, initial);
    const store = backend(dataDir, failDataDirectorySyncs(dataDir));
    await store.load();
    const next = snapshot([rootConversation('root', 'Uncertain write')]);

    await expect(store.commit(initial, next)).rejects.toBeInstanceOf(
      PersistenceUncertainCommitError,
    );

    expect(store.status()).toEqual({
      backend: 'file',
      health: 'error',
      durable: false,
      revision: 1,
      message: 'local persistence requires recovery',
    });
    await expect(store.load()).resolves.toEqual({
      status: 'ready',
      snapshot: initial,
      persistence: store.status(),
    });
    await expect(store.commit(initial, next)).rejects.toBeInstanceOf(
      PersistenceUncertainCommitError,
    );
  });
});

describe('atomic file publication', () => {
  it('does not overwrite a destination created during immutable publication', async () => {
    const { root } = await tempDataDirectory();
    const destination = join(root, 'node.json');
    let injected = false;
    const injectDestination = async () => {
      if (injected) return;
      injected = true;
      await writeFile(destination, 'incumbent', { flag: 'wx' });
    };
    const racingFileSystem = {
      ...nodeAtomicFileSystem,
      lstat: async (path: Parameters<typeof nodeAtomicFileSystem.lstat>[0]) => {
        if (path === destination) {
          await injectDestination();
          const error = new Error('not found') as NodeJS.ErrnoException;
          error.code = 'ENOENT';
          throw error;
        }
        return nodeAtomicFileSystem.lstat(path);
      },
      link: async (
        existingPath: Parameters<typeof nodeAtomicFileSystem.link>[0],
        newPath: Parameters<typeof nodeAtomicFileSystem.link>[1],
      ) => {
        if (newPath === destination) await injectDestination();
        const { link } = await import('node:fs/promises');
        return link(existingPath, newPath);
      },
    } as typeof nodeAtomicFileSystem;

    await expect(
      writeAtomicFile(racingFileSystem, destination, 'replacement', { overwrite: false }),
    ).rejects.toBeInstanceOf(AtomicDestinationExistsError);
    expect(await readFile(destination, 'utf8')).toBe('incumbent');
  });
});

describe('resolveFileDataDirectory', () => {
  it('defaults to cwd/.bonsai without consulting storage variables', () => {
    expect(
      resolveFileDataDirectory({
        cwd: '/workspace/bonsai',
        env: { NODE_ENV: 'development', DATABASE_URL: 'postgres://ignored' },
      }),
    ).toBe('/workspace/bonsai/.bonsai');
  });

  it('honors a non-production absolute BONSAI_DATA_DIR', () => {
    expect(
      resolveFileDataDirectory({
        cwd: '/workspace/bonsai',
        env: { NODE_ENV: 'development', BONSAI_DATA_DIR: '/var/tmp/bonsai-state' },
      }),
    ).toBe('/var/tmp/bonsai-state');
  });

  it.each([
    ['empty', '', 'development'],
    ['relative', 'relative/state', 'development'],
    ['production', '/var/tmp/bonsai-state', 'production'],
  ])('rejects an %s BONSAI_DATA_DIR before writing', (_name, dataDir, nodeEnv) => {
    expect(() =>
      resolveFileDataDirectory({
        cwd: '/workspace/bonsai',
        env: { NODE_ENV: nodeEnv, BONSAI_DATA_DIR: dataDir },
      }),
    ).toThrow(PersistenceConfigurationError);
  });
});
