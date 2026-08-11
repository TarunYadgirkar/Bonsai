import { isDeepStrictEqual } from 'node:util';
import { createKvTransport } from '../kv';
import type { CreateKvTransportOptions, KvTransport } from '../kv';
import { parseStoreSnapshot } from '../store-schema';
import type { StoreSnapshot } from '../store-schema';
import {
  PersistenceCommitError,
  PersistenceLoadError,
  PersistenceUncertainCommitError,
} from './errors';
import type {
  PersistenceBackend,
  PersistenceLoadResult,
  PersistenceStatus,
} from './types';

const SNAPSHOT_KEY = 'bonsai:store:v1';
const MAX_KV_PAYLOAD_BYTES = 16 * 1024 * 1024;

export interface KvPersistenceOptions extends CreateKvTransportOptions {
  transport?: KvTransport;
  maxPayloadBytes?: number;
}

/** KV commits are process-serialized but have no cross-lambda compare-and-swap guarantee. */
export class KvPersistenceBackend implements PersistenceBackend {
  readonly kind = 'kv' as const;
  private readonly transport: KvTransport;
  private readonly maxPayloadBytes: number;
  private persistence: PersistenceStatus = readyStatus();
  private poisoned = false;

  constructor(options: KvPersistenceOptions = {}) {
    this.transport = options.transport ?? createKvTransport(options);
    this.maxPayloadBytes = resolveMaximumPayload(options.maxPayloadBytes);
  }

  async load(): Promise<PersistenceLoadResult> {
    let value: string | null;
    try {
      value = await this.transport.get(SNAPSHOT_KEY);
    } catch {
      this.persistence = errorStatus();
      throw new PersistenceLoadError('KV persistence could not be loaded');
    }
    if (value === null) {
      this.persistence = this.poisoned ? errorStatus() : readyStatus();
      return { status: 'miss', persistence: this.status() };
    }
    if (Buffer.byteLength(value, 'utf8') > this.maxPayloadBytes) {
      this.persistence = errorStatus();
      throw new PersistenceLoadError('KV persistence payload exceeds the supported size');
    }
    try {
      const snapshot = parseStoreSnapshot(JSON.parse(value) as unknown);
      this.persistence = this.poisoned ? errorStatus() : readyStatus();
      return { status: 'ready', snapshot, persistence: this.status() };
    } catch {
      this.persistence = errorStatus();
      throw new PersistenceLoadError('KV persistence contains an invalid snapshot');
    }
  }

  async commit(
    previousValue: StoreSnapshot | null,
    nextValue: StoreSnapshot,
    options: { replaceInferenceLogView?: boolean } = {},
  ): Promise<PersistenceStatus> {
    if (this.poisoned) {
      throw new PersistenceUncertainCommitError('KV persistence requires restart or recovery');
    }
    const previous = previousValue ? parseStoreSnapshot(previousValue) : null;
    const next = parseStoreSnapshot(nextValue);
    if (!options.replaceInferenceLogView && previous && !hasLogPrefix(previous, next)) {
      throw new PersistenceCommitError('inference log history is not append-only');
    }
    const value = JSON.stringify(next);
    if (Buffer.byteLength(value, 'utf8') > this.maxPayloadBytes) {
      throw new PersistenceCommitError('KV persistence payload exceeds the supported size');
    }
    try {
      await this.transport.set(SNAPSHOT_KEY, value);
    } catch {
      this.poisoned = true;
      this.persistence = errorStatus();
      throw new PersistenceUncertainCommitError('KV persistence commit outcome is uncertain');
    }
    this.persistence = readyStatus();
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

function resolveMaximumPayload(value: number | undefined): number {
  if (value === undefined) return MAX_KV_PAYLOAD_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_KV_PAYLOAD_BYTES) {
    throw new PersistenceCommitError('KV persistence payload limit is invalid');
  }
  return value;
}

function readyStatus(): PersistenceStatus {
  return { backend: 'kv', health: 'ready', durable: true, revision: null };
}

function errorStatus(): PersistenceStatus {
  return {
    backend: 'kv',
    health: 'error',
    durable: true,
    revision: null,
    message: 'KV persistence is unavailable',
  };
}
