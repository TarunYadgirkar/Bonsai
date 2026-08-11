import type { StoreSnapshot } from '../store-schema';

export type PersistenceBackendKind = 'file' | 'kv' | 'memory';
export type PersistenceHealth = 'ready' | 'degraded' | 'error';

export interface PersistenceStatus {
  backend: PersistenceBackendKind;
  health: PersistenceHealth;
  durable: boolean;
  revision: number | null;
  message?: string;
  recoveredConversationIds?: string[];
}

export type PersistenceLoadResult =
  | { status: 'miss'; persistence: PersistenceStatus }
  | {
      status: 'ready' | 'degraded';
      snapshot: StoreSnapshot;
      persistence: PersistenceStatus;
    };

export interface PersistenceBackend {
  readonly kind: PersistenceBackendKind;
  load(): Promise<PersistenceLoadResult>;
  commit(
    previous: StoreSnapshot | null,
    next: StoreSnapshot,
    options?: { replaceInferenceLogView?: boolean },
  ): Promise<PersistenceStatus>;
  status(): PersistenceStatus;
}
