import { isDeepStrictEqual } from 'node:util';
import { parseStoreSnapshot } from '../store-schema';
import type { StoreSnapshot } from '../store-schema';
import {
  PersistenceCommitError,
  PersistenceConflictError,
  PersistenceError,
  PersistenceLoadError,
} from './errors';
import type {
  PersistenceBackend,
  PersistenceLoadResult,
  PersistenceStatus,
} from './types';

export interface MemoryPersistenceOptions {
  initialSnapshot?: StoreSnapshot;
  beforeLoad?: () => void | Promise<void>;
  beforeCommit?: (
    previous: StoreSnapshot | null,
    next: StoreSnapshot,
    options: { replaceInferenceLogView?: boolean },
  ) => void | Promise<void>;
}

export class MemoryPersistenceBackend implements PersistenceBackend {
  readonly kind = 'memory' as const;
  private snapshot: StoreSnapshot | null;
  private revision: number | null;
  private persistence: PersistenceStatus;
  private readonly beforeLoad?: MemoryPersistenceOptions['beforeLoad'];
  private readonly beforeCommit?: MemoryPersistenceOptions['beforeCommit'];

  constructor(options: MemoryPersistenceOptions = {}) {
    this.snapshot = options.initialSnapshot
      ? parseStoreSnapshot(options.initialSnapshot)
      : null;
    this.revision = this.snapshot ? 1 : null;
    this.persistence = readyStatus(this.revision);
    this.beforeLoad = options.beforeLoad;
    this.beforeCommit = options.beforeCommit;
  }

  async load(): Promise<PersistenceLoadResult> {
    try {
      await this.beforeLoad?.();
    } catch (error: unknown) {
      this.persistence = errorStatus(this.revision);
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceLoadError('memory persistence could not be loaded');
    }
    this.persistence = readyStatus(this.revision);
    if (!this.snapshot) return { status: 'miss', persistence: this.status() };
    return {
      status: 'ready',
      snapshot: parseStoreSnapshot(this.snapshot),
      persistence: this.status(),
    };
  }

  async commit(
    previousValue: StoreSnapshot | null,
    nextValue: StoreSnapshot,
    options: { replaceInferenceLogView?: boolean } = {},
  ): Promise<PersistenceStatus> {
    const previous = previousValue ? parseStoreSnapshot(previousValue) : null;
    const next = parseStoreSnapshot(nextValue);
    if (!isDeepStrictEqual(this.snapshot, previous)) {
      throw new PersistenceConflictError('memory persistence changed before commit');
    }
    if (!options.replaceInferenceLogView && previous && !hasLogPrefix(previous, next)) {
      throw new PersistenceCommitError('inference log history is not append-only');
    }
    try {
      await this.beforeCommit?.(
        previous ? structuredClone(previous) : null,
        structuredClone(next),
        { ...options },
      );
    } catch (error: unknown) {
      this.persistence = errorStatus(this.revision);
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceCommitError('memory persistence could not be committed');
    }
    this.snapshot = parseStoreSnapshot(next);
    this.revision = (this.revision ?? 0) + 1;
    this.persistence = readyStatus(this.revision);
    return this.status();
  }

  status(): PersistenceStatus {
    return { ...this.persistence };
  }
}

function hasLogPrefix(previous: StoreSnapshot, next: StoreSnapshot): boolean {
  return (
    previous.logs.length <= next.logs.length &&
    previous.logs.every((log, index) => isDeepStrictEqual(log, next.logs[index]))
  );
}

function readyStatus(revision: number | null): PersistenceStatus {
  return { backend: 'memory', health: 'ready', durable: false, revision };
}

function errorStatus(revision: number | null): PersistenceStatus {
  return {
    backend: 'memory',
    health: 'error',
    durable: false,
    revision,
    message: 'memory persistence is unavailable',
  };
}
