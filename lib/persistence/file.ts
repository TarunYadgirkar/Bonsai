import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { isSafePersistedId, parseStoreSnapshot } from '../store-schema';
import type { StoreSnapshot } from '../store-schema';
import type { InferenceLog } from '../types';
import {
  appendFileDurably,
  assertDirectoryNoFollow,
  AtomicDestinationExistsError,
  AtomicFileTooLargeError,
  AtomicFileTruncatedError,
  AtomicUnsafePathError,
  ensurePrivateDirectory,
  inspectPrivateRegularFile,
  isNotFound,
  listDirectoryNoFollow,
  nodeAtomicFileSystem,
  readBoundedFile,
  readBoundedFileWithIdentity,
  syncDirectory,
  truncateFileDurably,
  unlinkFileIfIdentity,
  unlinkIfPresent,
  visitFileRange,
  writeAtomicFile,
} from './atomic-file';
import type { AtomicFileSystem } from './atomic-file';
import type { FileIdentity } from './atomic-file';
import {
  PersistenceCommitError,
  PersistenceConfigurationError,
  PersistenceConflictError,
  PersistenceCorruptionError,
  PersistenceError,
  PersistenceLoadError,
  PersistenceRecoveryError,
  PersistenceSchemaError,
  PersistenceUnsupportedSchemaError,
  PersistenceUnsafePathError,
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
const QUARANTINE_DIRECTORY = 'quarantine';
const INFERENCE_LOG_FILENAME = 'inference-log.jsonl';
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_CONVERSATION_BYTES = 16 * 1024 * 1024;
const MAX_LOG_RECORD_BYTES = 1024 * 1024;
const LOG_READ_CHUNK_BYTES = 64 * 1024;
const MAX_ACTIVE_LOG_BYTES = 256 * 1024 * 1024;
const MAX_ACTIVE_LOG_RECORDS = 100_000;
const MAX_TOTAL_CONVERSATION_BYTES = 256 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 100_000;
const MAX_RECOVERY_CANDIDATES = 128;
const MAX_RECOVERY_COMBINATIONS = 4096;
const STALE_TEMP_GRACE_MS = 24 * 60 * 60 * 1000;
const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const MANIFEST_TEMP_PATTERN = new RegExp(
  `^\\.manifest\\.json\\.(\\d+)\\.${UUID_PATTERN}\\.tmp$`,
);
const CONVERSATION_TEMP_PATTERN = new RegExp(
  `^\\.(.+)\\.r([1-9]\\d*)\\.json\\.(\\d+)\\.${UUID_PATTERN}\\.tmp$`,
);
const QUARANTINE_TEMP_PATTERN = new RegExp(
  `^\\.(.+)\\.r([1-9]\\d*)\\.json\\.${UUID_PATTERN}\\.corrupt\\.(\\d+)\\.${UUID_PATTERN}\\.tmp$`,
);

type Environment = Readonly<Record<string, string | undefined>>;

export interface FilePersistenceOptions {
  cwd?: string;
  env?: Environment;
  fileSystem?: AtomicFileSystem;
  resourceLimits?: Partial<FilePersistenceResourceLimits>;
}

export interface FilePersistenceResourceLimits {
  maxActiveLogBytes: number;
  maxActiveLogRecords: number;
  maxConversationDirectoryEntries: number;
  maxTotalConversationBytes: number;
}

interface DiskState {
  manifest: ManifestV1;
  manifestBytes: Buffer;
  snapshot: StoreSnapshot;
  recoveredConversationIds: string[];
  recoveryCleanupIncomplete: boolean;
  conversationBytesById: Map<string, number>;
}

interface ConversationChoice {
  conversation: StoreSnapshot['conversations'][number];
  revision: number;
  size: number;
}

interface ConversationRevisionFile {
  filename: string;
  revision: number;
}

interface CorruptConversation {
  bytes: Buffer;
  conversationId: string;
  identity: FileIdentity;
  path: string;
  revision: number;
}

interface LogCommitPlan {
  startBytes: number;
  activeBytes: number;
  committedEndBytes: number;
  appendedLogs: InferenceLog[];
}

interface ConversationWrite {
  bytes: Buffer;
  path: string;
}

interface ConversationWritePlan {
  totalBytes: number;
  writes: ConversationWrite[];
}

export class FilePersistenceBackend implements PersistenceBackend {
  readonly kind = 'file' as const;
  private readonly dataDirectory: string;
  private readonly conversationsDirectory: string;
  private readonly manifestPath: string;
  private readonly inferenceLogPath: string;
  private readonly fileSystem: AtomicFileSystem;
  private readonly resourceLimits: FilePersistenceResourceLimits;
  private observedRevision: number | null | undefined;
  private persistence: PersistenceStatus = readyStatus(null);
  private poisoned = false;

  constructor(options: FilePersistenceOptions = {}) {
    this.dataDirectory = resolveFileDataDirectory(options);
    this.conversationsDirectory = join(this.dataDirectory, CONVERSATIONS_DIRECTORY);
    this.manifestPath = join(this.dataDirectory, MANIFEST_FILENAME);
    this.inferenceLogPath = join(this.dataDirectory, INFERENCE_LOG_FILENAME);
    this.fileSystem = options.fileSystem ?? nodeAtomicFileSystem;
    this.resourceLimits = resolveResourceLimits(options.resourceLimits);
  }

  async load(): Promise<PersistenceLoadResult> {
    try {
      const disk = await this.readDiskState(!this.poisoned);
      if (!disk) {
        this.observedRevision = null;
        this.persistence = this.poisoned ? errorStatus(null) : readyStatus(null);
        return { status: 'miss', persistence: this.status() };
      }
      const cleanupHealthy = this.poisoned
        ? true
        : await this.cleanupStaleTemporaryFiles();
      this.observedRevision = disk.manifest.revision;
      this.persistence = this.poisoned
        ? errorStatus(disk.manifest.revision)
        : disk.recoveredConversationIds.length > 0 || !cleanupHealthy
          ? degradedStatus(
              disk.manifest.revision,
              disk.recoveredConversationIds,
              disk.recoveryCleanupIncomplete
                ? 'recovered conversations; corrupt source cleanup requires attention'
                : cleanupHealthy
                  ? 'recovered corrupt conversations from prior revisions'
                : 'persistence cleanup requires attention',
            )
          : readyStatus(disk.manifest.revision);
      return {
        status:
          disk.recoveredConversationIds.length > 0 || !cleanupHealthy
            ? 'degraded'
            : 'ready',
        snapshot: disk.snapshot,
        persistence: this.status(),
      };
    } catch (error: unknown) {
      if (!this.poisoned) this.persistence = errorStatus(null);
      if (error instanceof PersistenceError) throw error;
      if (error instanceof AtomicUnsafePathError) {
        throw new PersistenceUnsafePathError('local persistence contains an unsafe path');
      }
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
    const conversationDirectory = await this.inspectConversationDirectory(
      current !== null,
    );
    const nextRevision = nextManifestRevision(
      current?.manifest.revision ?? null,
      conversationDirectory.highestRevision,
    );
    const logPlan = planLogCommit(
      current?.snapshot.logs ?? [],
      next.logs,
      current?.manifest ?? null,
      options.replaceInferenceLogView === true,
      this.resourceLimits,
    );
    const nextManifest = parseManifestV1(
      buildNextManifest(current, next, nextRevision, logPlan),
    );
    const conversationPlan = planConversationWrites(
      current,
      next,
      nextManifest,
      this.conversationsDirectory,
      this.resourceLimits.maxTotalConversationBytes,
    );
    if (
      conversationDirectory.entryCount +
        conversationPlan.writes.length +
        (conversationPlan.writes.length > 0 ? 1 : 0) >
      this.resourceLimits.maxConversationDirectoryEntries
    ) {
      throw new PersistenceCommitError(
        'conversation revision directory would exceed safe bounds',
      );
    }
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
      await this.writeChangedConversations(conversationPlan.writes);
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

  private async readDiskState(allowRecovery = true): Promise<DiskState | null> {
    try {
      await assertDirectoryNoFollow(this.fileSystem, this.dataDirectory, false);
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
    await assertDirectoryNoFollow(this.fileSystem, this.dataDirectory);
    const manifest = parseManifestV1(parseJson(manifestBytes, 'manifest'));
    await listDirectoryNoFollow(
      this.fileSystem,
      this.dataDirectory,
      true,
      MAX_DIRECTORY_ENTRIES,
    );
    await assertDirectoryNoFollow(this.fileSystem, this.conversationsDirectory);
    const conversationDirectoryEntries = await listDirectoryNoFollow(
      this.fileSystem,
      this.conversationsDirectory,
      true,
      this.resourceLimits.maxConversationDirectoryEntries,
    );
    const choices: ConversationChoice[][] = [];
    const corruptions: CorruptConversation[] = [];
    let conversationRevisionIndex: Map<string, ConversationRevisionFile[]> | undefined;
    const conversationFiles = new Map<
      string,
      { filename: string; identity: FileIdentity; path: string; revision: number }
    >();
    let conversationBytes = 0;
    for (const conversationId of manifest.conversationOrder) {
      const revision = manifest.conversations[conversationId];
      const filename = conversationFilename(conversationId, revision);
      const path = join(this.conversationsDirectory, filename);
      const identity = await inspectPrivateRegularFile(this.fileSystem, path);
      if (!identity) throw new AtomicUnsafePathError(path);
      if (identity.size > MAX_CONVERSATION_BYTES) {
        throw new AtomicFileTooLargeError(path);
      }
      conversationBytes += identity.size;
      if (conversationBytes > this.resourceLimits.maxTotalConversationBytes) {
        throw new PersistenceLoadError(
          'committed conversation envelope bytes exceed safe bounds',
        );
      }
      conversationFiles.set(conversationId, { filename, identity, path, revision });
    }
    const recoveryBudget = { bytes: conversationBytes };
    for (const conversationId of manifest.conversationOrder) {
      const file = conversationFiles.get(conversationId);
      if (!file) throw new PersistenceLoadError('conversation manifest is inconsistent');
      const { filename, identity, path, revision } = file;
      const current = await readBoundedFileWithIdentity(
        this.fileSystem,
        path,
        MAX_CONVERSATION_BYTES,
      );
      if (!sameFileIdentity(identity, current.identity)) {
        throw new PersistenceConflictError('conversation changed while persistence was loading');
      }
      try {
        const envelope = parseConversationEnvelopeV1(
          parseJson(current.bytes, 'conversation'),
          filename,
        );
        choices.push([
          {
            conversation: envelope.conversation,
            revision,
            size: current.identity.size,
          },
        ]);
      } catch (error: unknown) {
        if (error instanceof PersistenceUnsupportedSchemaError) throw error;
        if (!(error instanceof PersistenceSchemaError)) throw error;
        if (!allowRecovery) {
          throw new PersistenceCorruptionError(
            'a committed conversation is corrupt and requires recovery',
          );
        }
        conversationRevisionIndex ??= indexConversationRevisionFiles(
          conversationDirectoryEntries,
        );
        const candidates = await this.readRecoveryCandidates(
          revision,
          conversationRevisionIndex.get(conversationId) ?? [],
          recoveryBudget,
        );
        if (candidates.length === 0) {
          throw new PersistenceCorruptionError(
            'a committed conversation is corrupt and has no valid prior revision',
          );
        }
        choices.push(candidates);
        corruptions.push({
          bytes: current.bytes,
          conversationId,
          identity: current.identity,
          path,
          revision,
        });
      }
    }
    const logs = await this.readActiveLogs(manifest);
    if (corruptions.length === 0) {
      const selected = choices.map(([choice]) => choice);
      const snapshot = parseStoreSnapshot({
        conversations: selected.map(({ conversation }) => conversation),
        logs,
        rootId: manifest.rootId,
        seq: manifest.seq,
      });
      return {
        manifest,
        manifestBytes,
        snapshot,
        recoveredConversationIds: [],
        recoveryCleanupIncomplete: false,
        conversationBytesById: conversationByteMap(manifest, selected),
      };
    }
    const selected = selectValidConversationChoices(choices, manifest, logs);
    if (!selected) {
      throw new PersistenceCorruptionError(
        'committed conversations cannot be recovered into a valid snapshot',
      );
    }
    return this.repairCorruptConversations(
      manifest,
      manifestBytes,
      selected,
      corruptions,
    );
  }

  private async readRecoveryCandidates(
    currentRevision: number,
    revisionFiles: ConversationRevisionFile[],
    budget: { bytes: number },
  ): Promise<ConversationChoice[]> {
    const candidates = revisionFiles.filter(
      ({ revision }) => revision < currentRevision,
    );
    if (candidates.length > MAX_RECOVERY_CANDIDATES) {
      throw new PersistenceRecoveryError('conversation recovery candidates exceed safe bounds');
    }
    candidates.sort((left, right) => right.revision - left.revision);
    const valid: ConversationChoice[] = [];
    for (const candidate of candidates) {
      try {
        const path = join(this.conversationsDirectory, candidate.filename);
        const expected = await inspectPrivateRegularFile(this.fileSystem, path);
        if (!expected || expected.size > MAX_CONVERSATION_BYTES) continue;
        budget.bytes += expected.size;
        if (budget.bytes > this.resourceLimits.maxTotalConversationBytes) {
          throw new PersistenceRecoveryError(
            'conversation recovery envelope bytes exceed safe bounds',
          );
        }
        const file = await readBoundedFileWithIdentity(
          this.fileSystem,
          path,
          MAX_CONVERSATION_BYTES,
        );
        if (!sameFileIdentity(expected, file.identity)) {
          throw new PersistenceConflictError(
            'conversation changed while persistence was loading',
          );
        }
        const envelope = parseConversationEnvelopeV1(
          parseJson(file.bytes, 'conversation'),
          candidate.filename,
        );
        valid.push({
          conversation: envelope.conversation,
          revision: candidate.revision,
          size: file.identity.size,
        });
      } catch (error: unknown) {
        if (
          error instanceof PersistenceSchemaError ||
          error instanceof PersistenceUnsupportedSchemaError ||
          error instanceof AtomicUnsafePathError ||
          isNotFound(error)
        ) {
          continue;
        }
        throw error;
      }
    }
    return valid;
  }

  private async repairCorruptConversations(
    manifest: ManifestV1,
    manifestBytes: Buffer,
    selected: { choices: ConversationChoice[]; snapshot: StoreSnapshot },
    corruptions: CorruptConversation[],
  ): Promise<DiskState> {
    const { highestRevision } = await this.inspectConversationDirectory();
    const repairRevision = nextManifestRevision(manifest.revision, highestRevision);
    const repairedManifest = parseManifestV1({
      ...manifest,
      revision: repairRevision,
      conversations: Object.fromEntries(
        manifest.conversationOrder.map((conversationId, index) => [
          conversationId,
          selected.choices[index].revision,
        ]),
      ),
    });
    const repairedManifestBytes = encodeBoundedJson(
      repairedManifest,
      MAX_MANIFEST_BYTES,
      'manifest',
    );
    const quarantineDirectory = join(this.dataDirectory, QUARANTINE_DIRECTORY);

    try {
      await ensurePrivateDirectory(this.fileSystem, quarantineDirectory);
      for (const corruption of corruptions) {
        const quarantinePath = join(
          quarantineDirectory,
          `${conversationFilename(corruption.conversationId, corruption.revision)}.${randomUUID()}.corrupt`,
        );
        await writeAtomicFile(this.fileSystem, quarantinePath, corruption.bytes, {
          overwrite: false,
        });
      }
      await syncDirectory(this.fileSystem, quarantineDirectory);
    } catch (error: unknown) {
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceRecoveryError('corrupt conversation evidence could not be preserved');
    }

    const observedManifest = await readBoundedFile(
      this.fileSystem,
      this.manifestPath,
      MAX_MANIFEST_BYTES,
    );
    if (!observedManifest.equals(manifestBytes)) {
      throw new PersistenceConflictError('manifest changed during conversation recovery');
    }
    try {
      await this.commitManifest(manifestBytes, repairedManifestBytes);
    } catch (error: unknown) {
      if (error instanceof PersistenceUncertainCommitError) throw error;
      throw new PersistenceRecoveryError('repaired manifest could not be committed');
    }

    let removedAny = false;
    let recoveryCleanupIncomplete = false;
    for (const corruption of corruptions) {
      try {
        const removed = await unlinkFileIfIdentity(
          this.fileSystem,
          corruption.path,
          corruption.identity,
        );
        removedAny = removed || removedAny;
        recoveryCleanupIncomplete = !removed || recoveryCleanupIncomplete;
      } catch {
        recoveryCleanupIncomplete = true;
      }
    }
    if (removedAny) {
      try {
        await syncDirectory(this.fileSystem, this.conversationsDirectory);
      } catch {
        recoveryCleanupIncomplete = true;
      }
    }

    return {
      manifest: repairedManifest,
      manifestBytes: repairedManifestBytes,
      snapshot: selected.snapshot,
      recoveredConversationIds: corruptions.map(({ conversationId }) => conversationId),
      recoveryCleanupIncomplete,
      conversationBytesById: conversationByteMap(
        repairedManifest,
        selected.choices,
      ),
    };
  }

  private async readActiveLogs(manifest: ManifestV1): Promise<InferenceLog[]> {
    if (manifest.inferenceLogBytes > this.resourceLimits.maxActiveLogBytes) {
      throw new PersistenceLoadError('committed inference log range exceeds safe bounds');
    }
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
              throw new PersistenceCorruptionError(
                'committed inference log epoch is not line-aligned',
              );
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
            if (logs.length === this.resourceLimits.maxActiveLogRecords) {
              throw new PersistenceLoadError(
                'committed inference log record count exceeds safe bounds',
              );
            }
            try {
              logs.push(parseJson(line, 'inference log') as InferenceLog);
            } catch (error: unknown) {
              if (error instanceof PersistenceSchemaError) {
                throw new PersistenceCorruptionError('committed inference log is corrupt');
              }
              throw error;
            }
            pending = Buffer.alloc(0);
            offset = newline + 1;
          }
        },
      );
    } catch (error: unknown) {
      if (isNotFound(error)) throw new PersistenceLoadError('committed inference log is missing');
      if (error instanceof AtomicFileTruncatedError) {
        throw new PersistenceCorruptionError('committed inference log is truncated');
      }
      throw error;
    }
    if (pending.byteLength > 0) {
      throw new PersistenceCorruptionError('committed inference log epoch is incomplete');
    }
    return logs;
  }

  private async cleanupStaleTemporaryFiles(): Promise<boolean> {
    try {
      await this.cleanupStaleTemporaryFilesIn(
        this.dataDirectory,
        (filename) => tempFilePid(filename, MANIFEST_TEMP_PATTERN),
        MAX_DIRECTORY_ENTRIES,
      );
      await this.cleanupStaleTemporaryFilesIn(
        this.conversationsDirectory,
        conversationTempFilePid,
        this.resourceLimits.maxConversationDirectoryEntries,
      );
      try {
        await this.cleanupStaleTemporaryFilesIn(
          join(this.dataDirectory, QUARANTINE_DIRECTORY),
          quarantineTempFilePid,
          MAX_DIRECTORY_ENTRIES,
        );
      } catch (error: unknown) {
        if (!isNotFound(error)) throw error;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async cleanupStaleTemporaryFilesIn(
    directory: string,
    parsePid: (filename: string) => number | null,
    maximumEntries: number,
  ): Promise<void> {
    const filenames = await listDirectoryNoFollow(
      this.fileSystem,
      directory,
      true,
      maximumEntries,
    );
    let removedAny = false;
    const cutoff = Date.now() - STALE_TEMP_GRACE_MS;
    for (const filename of filenames) {
      const pid = parsePid(filename);
      if (pid === null || pid === process.pid) continue;
      const path = join(directory, filename);
      let identity: FileIdentity | null;
      try {
        identity = await inspectPrivateRegularFile(this.fileSystem, path);
      } catch (error: unknown) {
        if (isNotFound(error)) continue;
        throw error;
      }
      if (!identity || identity.mtimeMs > cutoff) continue;
      removedAny = (await unlinkFileIfIdentity(this.fileSystem, path, identity)) || removedAny;
    }
    if (removedAny) await syncDirectory(this.fileSystem, directory);
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
        write.bytes,
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

  private async inspectConversationDirectory(
    requirePrivate = true,
  ): Promise<{ entryCount: number; highestRevision: number }> {
    let filenames: string[];
    try {
      filenames = await listDirectoryNoFollow(
        this.fileSystem,
        this.conversationsDirectory,
        requirePrivate,
        this.resourceLimits.maxConversationDirectoryEntries,
      );
    } catch (error: unknown) {
      if (isNotFound(error)) return { entryCount: 0, highestRevision: 0 };
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
    return { entryCount: filenames.length, highestRevision: highest };
  }

  private async markPoisoned(): Promise<void> {
    this.poisoned = true;
    try {
      const revision = await this.readVisibleManifestRevision();
      this.observedRevision = revision;
      this.persistence = errorStatus(revision);
    } catch {
      this.observedRevision = undefined;
      this.persistence = errorStatus(null);
    }
  }

  private async readVisibleManifestRevision(): Promise<number | null> {
    try {
      await assertDirectoryNoFollow(this.fileSystem, this.dataDirectory, false);
      const bytes = await readBoundedFile(
        this.fileSystem,
        this.manifestPath,
        MAX_MANIFEST_BYTES,
      );
      await assertDirectoryNoFollow(this.fileSystem, this.dataDirectory);
      return parseManifestV1(parseJson(bytes, 'manifest')).revision;
    } catch (error: unknown) {
      if (isNotFound(error)) return null;
      throw error;
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
  maximumTotalBytes: number,
): ConversationWritePlan {
  const currentById = new Map(
    current?.snapshot.conversations.map((conversation) => [conversation.id, conversation]) ?? [],
  );
  const writes: ConversationWrite[] = [];
  let totalBytes = 0;
  for (const conversation of next.conversations) {
    const unchanged = isDeepStrictEqual(currentById.get(conversation.id), conversation);
    const revision = manifest.conversations[conversation.id];
    let bytes: Buffer | undefined;
    const size = unchanged
      ? current?.conversationBytesById.get(conversation.id)
      : (bytes = encodeBoundedJson(
          {
            schemaVersion: 1,
            conversationId: conversation.id,
            revision,
            conversation,
          } satisfies ConversationEnvelopeV1,
          MAX_CONVERSATION_BYTES,
          'conversation',
        )).byteLength;
    if (size === undefined) {
      throw new PersistenceCommitError('conversation size metadata is unavailable');
    }
    totalBytes += size;
    if (totalBytes > maximumTotalBytes) {
      throw new PersistenceCommitError(
        'conversation envelope bytes would exceed safe bounds',
      );
    }
    if (bytes) {
      writes.push({
        bytes,
        path: join(
          conversationsDirectory,
          conversationFilename(conversation.id, revision),
        ),
      });
    }
  }
  return { totalBytes, writes };
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
  limits: FilePersistenceResourceLimits,
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
  if (nextLogs.length > limits.maxActiveLogRecords) {
    throw new PersistenceCommitError('inference log record count would exceed safe bounds');
  }
  if (activeBytes > limits.maxActiveLogBytes) {
    throw new PersistenceCommitError('inference log byte range would exceed safe bounds');
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
    throw new PersistenceCorruptionError(
      'committed inference log record exceeds safe bounds',
    );
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

function indexConversationRevisionFiles(
  filenames: string[],
): Map<string, ConversationRevisionFile[]> {
  const index = new Map<string, ConversationRevisionFile[]>();
  for (const filename of filenames) {
    const match = /^(.+)\.r([1-9]\d*)\.json$/.exec(filename);
    if (!match || !isSafePersistedId(match[1])) continue;
    const revision = Number(match[2]);
    if (!Number.isSafeInteger(revision)) continue;
    const revisions = index.get(match[1]) ?? [];
    revisions.push({ filename, revision });
    index.set(match[1], revisions);
  }
  return index;
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.uid === right.uid
  );
}

function selectValidConversationChoices(
  choices: ConversationChoice[][],
  manifest: ManifestV1,
  logs: InferenceLog[],
): { choices: ConversationChoice[]; snapshot: StoreSnapshot } | null {
  const selected = choices.map(([choice]) => choice);
  const alternativePositions = choices.flatMap((options, index) =>
    options.length > 1 ? [index] : [],
  );
  const optionIndexes = new Map(alternativePositions.map((position) => [position, 0]));
  let attempts = 0;
  for (;;) {
    attempts += 1;
    if (attempts > MAX_RECOVERY_COMBINATIONS) {
      throw new PersistenceRecoveryError('conversation recovery search exceeds safe bounds');
    }
    try {
      return {
        choices: [...selected],
        snapshot: parseStoreSnapshot({
          conversations: selected.map(({ conversation }) => conversation),
          logs,
          rootId: manifest.rootId,
          seq: manifest.seq,
        }),
      };
    } catch (error: unknown) {
      if (!(error instanceof PersistenceSchemaError)) throw error;
    }
    let advanced = false;
    for (let cursor = alternativePositions.length - 1; cursor >= 0; cursor -= 1) {
      const position = alternativePositions[cursor];
      const nextIndex = (optionIndexes.get(position) ?? 0) + 1;
      if (nextIndex < choices[position].length) {
        optionIndexes.set(position, nextIndex);
        selected[position] = choices[position][nextIndex];
        for (let reset = cursor + 1; reset < alternativePositions.length; reset += 1) {
          const resetPosition = alternativePositions[reset];
          optionIndexes.set(resetPosition, 0);
          selected[resetPosition] = choices[resetPosition][0];
        }
        advanced = true;
        break;
      }
    }
    if (!advanced) return null;
  }
}

function conversationByteMap(
  manifest: ManifestV1,
  choices: ConversationChoice[],
): Map<string, number> {
  return new Map(
    manifest.conversationOrder.map((conversationId, index) => [
      conversationId,
      choices[index].size,
    ]),
  );
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

function resolveResourceLimits(
  values: Partial<FilePersistenceResourceLimits> | undefined,
): FilePersistenceResourceLimits {
  return {
    maxActiveLogBytes: resolveResourceLimit(
      values?.maxActiveLogBytes,
      MAX_ACTIVE_LOG_BYTES,
      'active log byte',
    ),
    maxActiveLogRecords: resolveResourceLimit(
      values?.maxActiveLogRecords,
      MAX_ACTIVE_LOG_RECORDS,
      'active log record',
    ),
    maxConversationDirectoryEntries: resolveResourceLimit(
      values?.maxConversationDirectoryEntries,
      MAX_DIRECTORY_ENTRIES,
      'conversation directory entry',
    ),
    maxTotalConversationBytes: resolveResourceLimit(
      values?.maxTotalConversationBytes,
      MAX_TOTAL_CONVERSATION_BYTES,
      'conversation envelope byte',
    ),
  };
}

function resolveResourceLimit(
  value: number | undefined,
  maximum: number,
  label: string,
): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new PersistenceConfigurationError(`${label} limit is invalid`);
  }
  return value;
}

function degradedStatus(
  revision: number,
  recoveredConversationIds: string[],
  message: string,
): PersistenceStatus {
  return {
    backend: 'file',
    health: 'degraded',
    durable: true,
    revision,
    message,
    ...(recoveredConversationIds.length > 0
      ? { recoveredConversationIds: [...recoveredConversationIds] }
      : {}),
  };
}

function tempFilePid(filename: string, pattern: RegExp): number | null {
  const match = pattern.exec(filename);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function conversationTempFilePid(filename: string): number | null {
  const match = CONVERSATION_TEMP_PATTERN.exec(filename);
  if (!match || !isSafePersistedId(match[1])) return null;
  const revision = Number(match[2]);
  const pid = Number(match[3]);
  return Number.isSafeInteger(revision) && Number.isSafeInteger(pid) && pid > 0
    ? pid
    : null;
}

function quarantineTempFilePid(filename: string): number | null {
  const match = QUARANTINE_TEMP_PATTERN.exec(filename);
  if (!match || !isSafePersistedId(match[1])) return null;
  const revision = Number(match[2]);
  const pid = Number(match[3]);
  return Number.isSafeInteger(revision) && Number.isSafeInteger(pid) && pid > 0
    ? pid
    : null;
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
