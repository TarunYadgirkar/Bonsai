import { isAbsolute, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseStoreSnapshot } from '../store-schema';
import type { StoreSnapshot } from '../store-schema';
import type { InferenceLog } from '../types';
import {
  appendFileDurably,
  assertDirectoryNoFollow,
  AtomicDestinationExistsError,
  ensurePrivateDirectory,
  isNotFound,
  listDirectoryNoFollow,
  nodeAtomicFileSystem,
  readBoundedFile,
  syncDirectory,
  truncateFileDurably,
  unlinkIfPresent,
  visitFileRange,
  writeAtomicFile,
} from './atomic-file';
import type { AtomicFileSystem } from './atomic-file';
import {
  PersistenceCommitError,
  PersistenceConfigurationError,
  PersistenceConflictError,
  PersistenceError,
  PersistenceLoadError,
  PersistenceSchemaError,
  PersistenceUncertainCommitError,
} from './errors';
import { parseConversationEnvelopeV1, parseManifestV1 } from './schema';
import type { ConversationEnvelopeV1, ManifestV1 } from './schema';
import type {
  PersistenceBackend,
  PersistenceLoadResult,
  PersistenceStatus,
} from './types';

const MANIFEST_FILENAME = 'manifest.json';
const CONVERSATIONS_DIRECTORY = 'conversations';
const INFERENCE_LOG_FILENAME = 'inference-log.jsonl';
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_CONVERSATION_BYTES = 16 * 1024 * 1024;
const MAX_LOG_RECORD_BYTES = 1024 * 1024;
const LOG_READ_CHUNK_BYTES = 64 * 1024;

type Environment = Readonly<Record<string, string | undefined>>;

export interface FilePersistenceOptions {
  cwd?: string;
  env?: Environment;
  fileSystem?: AtomicFileSystem;
}

interface DiskState {
  manifest: ManifestV1;
  manifestBytes: Buffer;
  snapshot: StoreSnapshot;
}

interface LogCommitPlan {
  startBytes: number;
  activeBytes: number;
  committedEndBytes: number;
  appendedLogs: InferenceLog[];
}

interface ConversationWrite {
  path: string;
  envelope: ConversationEnvelopeV1;
}

export class FilePersistenceBackend implements PersistenceBackend {
  readonly kind = 'file' as const;
  private readonly dataDirectory: string;
  private readonly conversationsDirectory: string;
  private readonly manifestPath: string;
  private readonly inferenceLogPath: string;
  private readonly fileSystem: AtomicFileSystem;
  private observedRevision: number | null | undefined;
  private persistence: PersistenceStatus = readyStatus(null);
  private poisoned = false;

  constructor(options: FilePersistenceOptions = {}) {
    this.dataDirectory = resolveFileDataDirectory(options);
    this.conversationsDirectory = join(this.dataDirectory, CONVERSATIONS_DIRECTORY);
    this.manifestPath = join(this.dataDirectory, MANIFEST_FILENAME);
    this.inferenceLogPath = join(this.dataDirectory, INFERENCE_LOG_FILENAME);
    this.fileSystem = options.fileSystem ?? nodeAtomicFileSystem;
  }

  async load(): Promise<PersistenceLoadResult> {
    try {
      const disk = await this.readDiskState();
      if (!disk) {
        this.observedRevision = null;
        this.persistence = this.poisoned ? errorStatus(null) : readyStatus(null);
        return { status: 'miss', persistence: this.status() };
      }
      this.observedRevision = disk.manifest.revision;
      this.persistence = this.poisoned
        ? errorStatus(disk.manifest.revision)
        : readyStatus(disk.manifest.revision);
      return {
        status: 'ready',
        snapshot: disk.snapshot,
        persistence: this.status(),
      };
    } catch (error: unknown) {
      this.persistence = errorStatus(null);
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceLoadError('local persistence could not be loaded');
    }
  }

  async commit(
    previousValue: StoreSnapshot | null,
    nextValue: StoreSnapshot,
    options: { replaceInferenceLogView?: boolean } = {},
  ): Promise<PersistenceStatus> {
    if (this.poisoned) {
      throw new PersistenceUncertainCommitError('local persistence requires restart or recovery');
    }
    const previous = previousValue ? parseStoreSnapshot(previousValue) : null;
    const next = parseStoreSnapshot(nextValue);
    const current = await this.readDiskStateForCommit();
    this.assertExpectedState(current, previous);
    const existingRevision = await this.highestConversationRevision();
    const nextRevision = nextManifestRevision(
      current?.manifest.revision ?? null,
      existingRevision,
    );
    const logPlan = planLogCommit(
      current?.snapshot.logs ?? [],
      next.logs,
      current?.manifest ?? null,
      options.replaceInferenceLogView === true,
    );
    const nextManifest = parseManifestV1(
      buildNextManifest(current, next, nextRevision, logPlan),
    );
    const conversationWrites = planConversationWrites(
      current,
      next,
      nextManifest,
      this.conversationsDirectory,
    );
    const manifestBytes = encodeBoundedJson(
      nextManifest,
      MAX_MANIFEST_BYTES,
      'manifest',
    );

    try {
      await ensurePrivateDirectory(this.fileSystem, this.dataDirectory);
      await ensurePrivateDirectory(this.fileSystem, this.conversationsDirectory);
      await truncateFileDurably(
        this.fileSystem,
        this.inferenceLogPath,
        logPlan.committedEndBytes,
      );
      await this.writeChangedConversations(conversationWrites);
      await syncDirectory(this.fileSystem, this.conversationsDirectory);
      await appendFileDurably(
        this.fileSystem,
        this.inferenceLogPath,
        encodeLogRecords(logPlan.appendedLogs),
      );
      await this.commitManifest(current?.manifestBytes ?? null, manifestBytes);
    } catch (error: unknown) {
      if (error instanceof PersistenceError) throw error;
      if (error instanceof AtomicDestinationExistsError) {
        throw new PersistenceConflictError('conversation revision already exists');
      }
      throw new PersistenceCommitError('local persistence commit failed');
    }

    this.observedRevision = nextRevision;
    this.persistence = readyStatus(nextRevision);
    return this.status();
  }

  status(): PersistenceStatus {
    return {
      ...this.persistence,
      ...(this.persistence.recoveredConversationIds
        ? { recoveredConversationIds: [...this.persistence.recoveredConversationIds] }
        : {}),
    };
  }

  private async readDiskStateForCommit(): Promise<DiskState | null> {
    try {
      return await this.readDiskState();
    } catch (error: unknown) {
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceCommitError('current local persistence state is unreadable');
    }
  }

  private async readDiskState(): Promise<DiskState | null> {
    try {
      await assertDirectoryNoFollow(this.fileSystem, this.dataDirectory);
    } catch (error: unknown) {
      if (isNotFound(error)) return null;
      throw error;
    }
    let manifestBytes: Buffer;
    try {
      manifestBytes = await readBoundedFile(
        this.fileSystem,
        this.manifestPath,
        MAX_MANIFEST_BYTES,
      );
    } catch (error: unknown) {
      if (isNotFound(error)) return null;
      throw error;
    }
    const manifest = parseManifestV1(parseJson(manifestBytes, 'manifest'));
    await assertDirectoryNoFollow(this.fileSystem, this.conversationsDirectory);
    const conversations = [];
    for (const conversationId of manifest.conversationOrder) {
      const revision = manifest.conversations[conversationId];
      const filename = conversationFilename(conversationId, revision);
      const bytes = await readBoundedFile(
        this.fileSystem,
        join(this.conversationsDirectory, filename),
        MAX_CONVERSATION_BYTES,
      );
      conversations.push(
        parseConversationEnvelopeV1(parseJson(bytes, 'conversation'), filename).conversation,
      );
    }
    const logs = await this.readActiveLogs(manifest);
    const snapshot = parseStoreSnapshot({
      conversations,
      logs,
      rootId: manifest.rootId,
      seq: manifest.seq,
    });
    return { manifest, manifestBytes, snapshot };
  }

  private async readActiveLogs(manifest: ManifestV1): Promise<InferenceLog[]> {
    const prefixBytes = manifest.inferenceLogStartBytes > 0 ? 1 : 0;
    const logs: InferenceLog[] = [];
    let pending: Buffer = Buffer.alloc(0);
    let prefixPending = prefixBytes > 0;
    try {
      await visitFileRange(
        this.fileSystem,
        this.inferenceLogPath,
        manifest.inferenceLogStartBytes - prefixBytes,
        manifest.inferenceLogBytes + prefixBytes,
        LOG_READ_CHUNK_BYTES,
        (chunk) => {
          let content = chunk;
          if (prefixPending) {
            if (content[0] !== 0x0a) {
              throw new PersistenceLoadError('inference log epoch is not line-aligned');
            }
            content = content.subarray(1);
            prefixPending = false;
          }
          let offset = 0;
          while (offset < content.byteLength) {
            const newline = content.indexOf(0x0a, offset);
            if (newline === -1) {
              pending = appendLogFragment(pending, content.subarray(offset));
              return;
            }
            const line = appendLogFragment(pending, content.subarray(offset, newline));
            logs.push(parseJson(line, 'inference log') as InferenceLog);
            pending = Buffer.alloc(0);
            offset = newline + 1;
          }
        },
      );
    } catch (error: unknown) {
      if (isNotFound(error)) throw new PersistenceLoadError('committed inference log is missing');
      throw error;
    }
    if (pending.byteLength > 0) {
      throw new PersistenceLoadError('inference log epoch is incomplete');
    }
    return logs;
  }

  private assertExpectedState(current: DiskState | null, previous: StoreSnapshot | null): void {
    const currentRevision = current?.manifest.revision ?? null;
    if (this.observedRevision !== undefined && this.observedRevision !== currentRevision) {
      throw new PersistenceConflictError('manifest revision changed since it was observed');
    }
    if (!current && previous) {
      throw new PersistenceConflictError('expected persisted state is missing');
    }
    if (current && !previous) {
      throw new PersistenceConflictError('persisted state already exists');
    }
    if (current && previous && !isDeepStrictEqual(current.snapshot, previous)) {
      throw new PersistenceConflictError('expected snapshot does not match persisted state');
    }
  }

  private async writeChangedConversations(writes: ConversationWrite[]): Promise<void> {
    for (const write of writes) {
      await writeAtomicFile(
        this.fileSystem,
        write.path,
        encodeBoundedJson(write.envelope, MAX_CONVERSATION_BYTES, 'conversation'),
        { overwrite: false },
      );
    }
  }

  private async commitManifest(
    previousManifestBytes: Buffer | null,
    manifestBytes: Buffer,
  ): Promise<void> {
    await writeAtomicFile(this.fileSystem, this.manifestPath, manifestBytes, {
      overwrite: true,
    });
    try {
      await syncDirectory(this.fileSystem, this.dataDirectory);
    } catch {
      try {
        if (previousManifestBytes) {
          await writeAtomicFile(this.fileSystem, this.manifestPath, previousManifestBytes, {
            overwrite: true,
          });
        } else {
          await unlinkIfPresent(this.fileSystem, this.manifestPath);
        }
        await syncDirectory(this.fileSystem, this.dataDirectory);
      } catch {
        await this.markPoisoned();
        throw new PersistenceUncertainCommitError('manifest commit outcome is uncertain');
      }
      throw new PersistenceCommitError('manifest durability acknowledgement failed');
    }
  }

  private async highestConversationRevision(): Promise<number> {
    let filenames: string[];
    try {
      filenames = await listDirectoryNoFollow(this.fileSystem, this.conversationsDirectory);
    } catch (error: unknown) {
      if (isNotFound(error)) return 0;
      throw new PersistenceCommitError('conversation revision directory is unsafe');
    }
    let highest = 0;
    for (const filename of filenames) {
      const match = /^.+\.r(\d+)\.json$/.exec(filename);
      if (!match) continue;
      const revision = Number(match[1]);
      if (!Number.isSafeInteger(revision) || revision <= 0) {
        throw new PersistenceCommitError('conversation revision is exhausted');
      }
      highest = Math.max(highest, revision);
    }
    return highest;
  }

  private async markPoisoned(): Promise<void> {
    this.poisoned = true;
    try {
      const visible = await this.readDiskState();
      this.observedRevision = visible?.manifest.revision ?? null;
      this.persistence = errorStatus(visible?.manifest.revision ?? null);
    } catch {
      this.observedRevision = undefined;
      this.persistence = errorStatus(null);
    }
  }
}

export function resolveFileDataDirectory(options: FilePersistenceOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const configured = env.BONSAI_DATA_DIR;
  if (configured !== undefined) {
    if (!configured || !isAbsolute(configured)) {
      throw new PersistenceConfigurationError('BONSAI_DATA_DIR must be an absolute path');
    }
    if (env.NODE_ENV === 'production') {
      throw new PersistenceConfigurationError('BONSAI_DATA_DIR cannot override production storage');
    }
    return resolve(configured);
  }
  if (!isAbsolute(cwd)) throw new PersistenceConfigurationError('persistence cwd must be absolute');
  return resolve(cwd, '.bonsai');
}

function planConversationWrites(
  current: DiskState | null,
  next: StoreSnapshot,
  manifest: ManifestV1,
  conversationsDirectory: string,
): ConversationWrite[] {
  const currentById = new Map(
    current?.snapshot.conversations.map((conversation) => [conversation.id, conversation]) ?? [],
  );
  return next.conversations.flatMap((conversation): ConversationWrite[] => {
    if (isDeepStrictEqual(currentById.get(conversation.id), conversation)) return [];
    const revision = manifest.conversations[conversation.id];
    const filename = conversationFilename(conversation.id, revision);
    const envelope: ConversationEnvelopeV1 = {
      schemaVersion: 1,
      conversationId: conversation.id,
      revision,
      conversation,
    };
    encodeBoundedJson(envelope, MAX_CONVERSATION_BYTES, 'conversation');
    return [
      {
        path: join(conversationsDirectory, filename),
        envelope,
      },
    ];
  });
}

function buildNextManifest(
  current: DiskState | null,
  next: StoreSnapshot,
  revision: number,
  logs: LogCommitPlan,
): ManifestV1 {
  const currentById = new Map(
    current?.snapshot.conversations.map((conversation) => [conversation.id, conversation]) ?? [],
  );
  const conversationEntries = next.conversations.map((conversation): [string, number] => {
    const priorRevision = current?.manifest.conversations[conversation.id];
    return [
      conversation.id,
      priorRevision !== undefined && isDeepStrictEqual(currentById.get(conversation.id), conversation)
        ? priorRevision
        : revision,
    ];
  });
  return {
    schemaVersion: 1,
    revision,
    rootId: next.rootId,
    seq: next.seq,
    conversations: Object.fromEntries(conversationEntries),
    conversationOrder: next.conversations.map(({ id }) => id),
    inferenceLogStartBytes: logs.startBytes,
    inferenceLogBytes: logs.activeBytes,
  };
}

function planLogCommit(
  currentLogs: InferenceLog[],
  nextLogs: InferenceLog[],
  currentManifest: ManifestV1 | null,
  replace: boolean,
): LogCommitPlan {
  const committedEndBytes = currentManifest
    ? currentManifest.inferenceLogStartBytes + currentManifest.inferenceLogBytes
    : 0;
  if (!replace && !isLogPrefix(currentLogs, nextLogs)) {
    throw new PersistenceCommitError(
      'inference log view diverged; replacement must be explicit',
    );
  }
  const appendedLogs = replace ? nextLogs : nextLogs.slice(currentLogs.length);
  const appendedBytes = measureLogRecords(appendedLogs);
  const activeBytes = replace
    ? appendedBytes
    : (currentManifest?.inferenceLogBytes ?? 0) + appendedBytes;
  if (!Number.isSafeInteger(activeBytes)) {
    throw new PersistenceCommitError('inference log byte range is exhausted');
  }
  return {
    startBytes: replace ? committedEndBytes : (currentManifest?.inferenceLogStartBytes ?? 0),
    activeBytes,
    committedEndBytes,
    appendedLogs,
  };
}

function isLogPrefix(previous: InferenceLog[], next: InferenceLog[]): boolean {
  return (
    next.length >= previous.length &&
    previous.every((log, index) => isDeepStrictEqual(log, next[index]))
  );
}

function measureLogRecords(logs: InferenceLog[]): number {
  let total = 0;
  for (const log of logs) {
    total += encodeLogRecord(log).byteLength;
    if (!Number.isSafeInteger(total)) {
      throw new PersistenceCommitError('inference log byte range is exhausted');
    }
  }
  return total;
}

function* encodeLogRecords(logs: InferenceLog[]): Generator<Buffer> {
  for (const log of logs) yield encodeLogRecord(log);
}

function encodeLogRecord(log: InferenceLog): Buffer {
  const record = Buffer.from(`${JSON.stringify(log)}\n`);
  if (record.byteLength > MAX_LOG_RECORD_BYTES + 1) {
    throw new PersistenceCommitError('inference log record exceeds safe bounds');
  }
  return record;
}

function appendLogFragment(pending: Buffer, fragment: Buffer): Buffer {
  if (pending.byteLength + fragment.byteLength > MAX_LOG_RECORD_BYTES) {
    throw new PersistenceLoadError('committed inference log record exceeds safe bounds');
  }
  if (pending.byteLength === 0) return fragment;
  if (fragment.byteLength === 0) return pending;
  return Buffer.concat([pending, fragment]);
}

function encodeBoundedJson(
  value: unknown,
  maximumBytes: number,
  label: string,
): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  if (bytes.byteLength > maximumBytes) {
    throw new PersistenceCommitError(`${label} exceeds safe bounds`);
  }
  return bytes;
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new PersistenceSchemaError(`${label} contains invalid JSON`);
  }
}

function conversationFilename(conversationId: string, revision: number): string {
  return `${conversationId}.r${revision}.json`;
}

function nextManifestRevision(current: number | null, existingRevision: number): number {
  const highest = Math.max(current ?? 0, existingRevision);
  if (highest === Number.MAX_SAFE_INTEGER) {
    throw new PersistenceCommitError('manifest revision is exhausted');
  }
  return highest + 1;
}

function readyStatus(revision: number | null): PersistenceStatus {
  return { backend: 'file', health: 'ready', durable: true, revision };
}

function errorStatus(revision: number | null): PersistenceStatus {
  return {
    backend: 'file',
    health: 'error',
    durable: false,
    revision,
    message: 'local persistence requires recovery',
  };
}
