import { AsyncLocalStorage } from 'node:async_hooks';
import seed from '@/fixtures/seed-conversation.json';
import tree from '@/fixtures/seed-tree.json';
import { assembleVisibleContext } from './context';
import { PersistenceUncertainCommitError } from './persistence/errors';
import { selectPersistenceBackend } from './persistence/select';
import type { PersistenceBackend, PersistenceStatus } from './persistence/types';
import {
  normalizeInferenceLog,
  normalizeInsight,
  normalizeStoredConversation,
  parseStoreSnapshot,
} from './store-schema';
import type { SeedTree, StoreSnapshot } from './store-schema';
import { estimateTokens, messagesTokens, prunedPct } from './tokens';
import type {
  AssembledContext,
  BranchNode,
  Conversation,
  ContextBrief,
  InferenceLog,
  Insight,
  Message,
  SeedConversation,
  StateResponse,
  Tier,
} from './types';

interface StoreShape {
  conversations: Map<string, Conversation>;
  logs: InferenceLog[];
  rootId: string;
  seq: number;
}

const GLOBAL_KEY = Symbol.for('bonsai.store');
const RUNTIME_KEY = Symbol.for('bonsai.store.persistence');
const transactionStorage = new AsyncLocalStorage<TransactionContext>();

interface TransactionContext {
  active: boolean;
  draft: StoreShape;
}

interface StoreRuntime {
  backend?: PersistenceBackend;
  legacyPrevious?: StoreSnapshot | null;
  poisoned: boolean;
  readUnavailable: boolean;
  tail: Promise<void>;
}

export interface StoreTransactionOptions {
  replaceInferenceLogView?: boolean;
}

export class StoreSequenceExhaustedError extends Error {
  constructor() {
    super('store sequence exhausted');
    this.name = 'StoreSequenceExhaustedError';
  }
}

export class StoreNestedTransactionError extends Error {
  constructor() {
    super('nested store transactions are not supported');
    this.name = 'StoreNestedTransactionError';
  }
}

export class StoreInactiveTransactionError extends Error {
  constructor() {
    super('store transaction context is no longer active');
    this.name = 'StoreInactiveTransactionError';
  }
}

/**
 * Boots the pre-built demo tree: the root transcript from `seed-conversation.json` plus the
 * scenario branches, insights and inference logs frozen in `seed-tree.json` (regenerate with
 * scripts/build-seed-tree.ts). The root's messages live in one file only — the tree fixture
 * carries what the branches added, never a copy of the transcript.
 */
function build(): StoreShape {
  const fixture = structuredClone(seed) as SeedConversation;
  // Clone: an imported JSON module is a live singleton, and `logs` is pushed to in place by
  // logInference. Without this, rehearsal logs stayed in the fixture array for the life of the
  // process and every reset handed them straight back.
  const preloaded = shouldUseRootOnlyFixture()
    ? {}
    : (structuredClone(tree) as SeedTree);
  const root: Conversation = {
    id: fixture.id,
    title: fixture.title,
    parentId: null,
    profile: fixture.profile,
    messages: fixture.messages,
    insights: (preloaded.rootInsights ?? []).map(normalizeInsight),
    pinnedTier: null,
    archived: false,
  };
  const branches = (preloaded.branches ?? []).map(normalizeStoredConversation);
  return {
    conversations: new Map([root, ...branches].map((c) => [c.id, c])),
    logs: (preloaded.logs ?? []).map(normalizeInferenceLog),
    rootId: root.id,
    seq: preloaded.seq ?? 0,
  };
}

function shouldUseRootOnlyFixture(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.BONSAI_ROOT_ONLY_FIXTURE === '1';
}

function store(): StoreShape {
  const context = transactionStorage.getStore();
  if (context) {
    if (!context.active) throw new StoreInactiveTransactionError();
    return context.draft;
  }
  return publishedStore();
}

function publishedStore(): StoreShape {
  if (runtime().readUnavailable) {
    throw new PersistenceUncertainCommitError('authoritative persistence state is unavailable');
  }
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: StoreShape };
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = build();
  return g[GLOBAL_KEY];
}

function setStore(next: StoreShape): void {
  (globalThis as typeof globalThis & { [GLOBAL_KEY]?: StoreShape })[GLOBAL_KEY] = next;
}

function runtime(): StoreRuntime {
  const g = globalThis as typeof globalThis & { [RUNTIME_KEY]?: StoreRuntime };
  if (!g[RUNTIME_KEY]) {
    g[RUNTIME_KEY] = { poisoned: false, readUnavailable: false, tail: Promise.resolve() };
  }
  return g[RUNTIME_KEY];
}

function persistenceBackend(): PersistenceBackend {
  const state = runtime();
  state.backend ??= selectPersistenceBackend();
  return state.backend;
}

function toSnapshot(s: StoreShape): StoreSnapshot {
  return parseStoreSnapshot({
    conversations: [...s.conversations.values()].map((conversation) =>
      structuredClone(conversation),
    ),
    logs: s.logs.map((log) => structuredClone(log)),
    rootId: s.rootId,
    seq: s.seq,
  });
}

function fromSnapshot(snapshot: StoreSnapshot): StoreShape {
  const parsed = parseStoreSnapshot(snapshot);
  const conversations = parsed.conversations.map((conversation) => structuredClone(conversation));
  return {
    conversations: new Map(conversations.map((conversation) => [conversation.id, conversation])),
    logs: parsed.logs.map((log) => structuredClone(log)),
    rootId: parsed.rootId,
    seq: parsed.seq,
  };
}

export async function loadStore(): Promise<void> {
  assertOutsideTransaction();
  await enqueue(async () => {
    const state = runtime();
    const backend = persistenceBackend();
    const loaded = await backend.load();
    if (loaded.status === 'miss') {
      if (state.poisoned) {
        throw new PersistenceUncertainCommitError('persistence state is uncertain');
      }
      const seedSnapshot = toSnapshot(build());
      try {
        await backend.commit(null, seedSnapshot);
      } catch (error: unknown) {
        if (error instanceof PersistenceUncertainCommitError) {
          await reconcileUncertainCommit(backend, error);
        }
        throw error;
      }
      setStore(fromSnapshot(seedSnapshot));
      state.readUnavailable = false;
      state.legacyPrevious = parseStoreSnapshot(seedSnapshot);
      return;
    }
    setStore(fromSnapshot(loaded.snapshot));
    state.readUnavailable = false;
    state.legacyPrevious = parseStoreSnapshot(loaded.snapshot);
  });
}

export async function saveStore(): Promise<void> {
  assertOutsideTransaction();
  const next = toSnapshot(publishedStore());
  await enqueue(async () => {
    const state = runtime();
    if (state.poisoned) {
      throw new PersistenceUncertainCommitError('persistence state is uncertain');
    }
    const backend = persistenceBackend();
    let previous = state.legacyPrevious;
    if (previous === undefined) {
      const loaded = await backend.load();
      previous = loaded.status === 'miss' ? null : parseStoreSnapshot(loaded.snapshot);
    }
    try {
      await backend.commit(previous, next);
    } catch (error: unknown) {
      if (error instanceof PersistenceUncertainCommitError) {
        await reconcileUncertainCommit(backend, error);
      }
      if (previous) setStore(fromSnapshot(previous));
      throw error;
    }
    setStore(fromSnapshot(next));
    state.legacyPrevious = parseStoreSnapshot(next);
  });
}

export async function resetStore(): Promise<StateResponse> {
  await transactStore(
    () => {
      const context = requireActiveTransaction();
      context.draft = build();
    },
    { replaceInferenceLogView: true },
  );
  return {
    rootId: rootId(),
    tree: buildTree(),
    conversations: listConversations(),
    persistence: persistenceStatus(),
  };
}

export function persistenceStatus(): PersistenceStatus {
  return persistenceBackend().status();
}

export function configureStorePersistenceForTests(backend: PersistenceBackend): void {
  const state = runtime();
  state.backend = backend;
  state.legacyPrevious = undefined;
  state.poisoned = false;
  state.readUnavailable = false;
  state.tail = Promise.resolve();
  setStore(build());
}

export async function transactStore<T>(
  work: () => T | Promise<T>,
  options: StoreTransactionOptions = {},
): Promise<T> {
  assertOutsideTransaction();
  return enqueue(async () => {
    const state = runtime();
    if (state.poisoned) {
      throw new PersistenceUncertainCommitError('persistence state is uncertain');
    }
    const backend = persistenceBackend();
    const loaded = await backend.load();
    const previous = loaded.status === 'miss' ? null : parseStoreSnapshot(loaded.snapshot);
    if (previous) {
      setStore(fromSnapshot(previous));
      state.legacyPrevious = parseStoreSnapshot(previous);
    }
    const context: TransactionContext = {
      active: true,
      draft: previous ? fromSnapshot(previous) : build(),
    };
    let result: T;
    try {
      result = await transactionStorage.run(context, work);
    } finally {
      context.active = false;
    }
    const next = toSnapshot(context.draft);
    try {
      await backend.commit(previous, next, options);
    } catch (error: unknown) {
      if (error instanceof PersistenceUncertainCommitError) {
        await reconcileUncertainCommit(backend, error);
      }
      throw error;
    }
    setStore(fromSnapshot(next));
    state.legacyPrevious = parseStoreSnapshot(next);
    return result;
  });
}

function assertOutsideTransaction(): void {
  const context = transactionStorage.getStore();
  if (!context) return;
  if (!context.active) throw new StoreInactiveTransactionError();
  throw new StoreNestedTransactionError();
}

function requireActiveTransaction(): TransactionContext {
  const context = transactionStorage.getStore();
  if (!context || !context.active) throw new StoreInactiveTransactionError();
  return context;
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const state = runtime();
  const result = state.tail.then(work);
  state.tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function reconcileUncertainCommit(
  backend: PersistenceBackend,
  error: PersistenceUncertainCommitError,
): Promise<never> {
  const state = runtime();
  state.poisoned = true;
  state.readUnavailable = true;
  try {
    const visible = await backend.load();
    if (visible.status !== 'miss') {
      setStore(fromSnapshot(visible.snapshot));
      state.readUnavailable = false;
      state.legacyPrevious = parseStoreSnapshot(visible.snapshot);
    } else {
      state.legacyPrevious = null;
    }
  } catch {
    state.legacyPrevious = undefined;
  }
  throw error;
}

export function nextId(prefix: string): string {
  const s = store();
  if (s.seq === Number.MAX_SAFE_INTEGER) throw new StoreSequenceExhaustedError();
  s.seq += 1;
  return `${prefix}_${s.seq}`;
}

export function rootId(): string {
  return store().rootId;
}

export function getConversation(id: string): Conversation | undefined {
  const conversation = store().conversations.get(id);
  return conversation ? structuredClone(conversation) : undefined;
}

export function visibleContextFor(id: string): AssembledContext | undefined {
  if (!getConversation(id)) return undefined;
  return assembleVisibleContext(id, getConversation);
}

export function listConversations(): Conversation[] {
  return [...store().conversations.values()].map((conversation) =>
    structuredClone(conversation),
  );
}

export function putConversation(conversation: Conversation): void {
  store().conversations.set(conversation.id, structuredClone(conversation));
}

/** Immutable update — replaces the stored node rather than mutating it. */
export function updateConversation(
  id: string,
  patch: (c: Conversation) => Conversation,
): Conversation | undefined {
  const current = store().conversations.get(id);
  if (!current) return undefined;
  const next = structuredClone(patch(structuredClone(current)));
  store().conversations.set(id, next);
  return structuredClone(next);
}

export function appendMessage(id: string, message: Message): Conversation | undefined {
  return updateConversation(id, (c) => ({ ...c, messages: [...c.messages, message] }));
}

export function appendInsight(parentId: string, insight: Insight): Conversation | undefined {
  return updateConversation(parentId, (c) => ({ ...c, insights: [...c.insights, insight] }));
}

export function logInference(log: InferenceLog): InferenceLog {
  const cloned = structuredClone(log);
  store().logs.push(cloned);
  return structuredClone(cloned);
}

export async function flushLogs(): Promise<void> {
  return;
}

export function listLogs(): InferenceLog[] {
  return store().logs.map((log) => structuredClone(log));
}

/** Full parent history a branch could have inherited — the baseline every saving is measured against. */
export function availableTokensFor(parentId: string | null): number {
  if (!parentId) return 0;
  const parent = getConversation(parentId);
  if (!parent) return 0;
  const profileTokens = parent.profile
    ? messagesTokens([
        {
          id: 'profile',
          role: 'user',
          content: [parent.profile.name, parent.profile.context, ...parent.profile.goals].join(' '),
        },
      ])
    : 0;
  const insightTokens = parent.insights
    .filter((insight) => insight.active !== false)
    .reduce((sum, insight) => sum + estimateTokens(insight.text), 0);
  return (
    messagesTokens(parent.messages) +
    profileTokens +
    insightTokens +
    availableTokensFor(parent.parentId)
  );
}

function lastTier(c: Conversation): Tier | null {
  for (let i = c.messages.length - 1; i >= 0; i -= 1) {
    const routing = c.messages[i].routing;
    if (routing) return routing.tier;
  }
  return null;
}

function depthOf(c: Conversation): number {
  let depth = 0;
  let cursor = c.parentId;
  while (cursor) {
    const parent = getConversation(cursor);
    if (!parent) break;
    depth += 1;
    cursor = parent.parentId;
  }
  return depth;
}

/** Derived projection for the sidebar. Never stored — always recomputed. */
export function buildTree(): BranchNode[] {
  const all = listConversations();
  return all.map((c) => {
    const brief: ContextBrief | undefined = c.brief;
    return {
      id: c.id,
      title: c.title,
      parentId: c.parentId,
      childIds: all.filter((x) => x.parentId === c.id).map((x) => x.id),
      depth: depthOf(c),
      messageCount: c.messages.length,
      pinnedTier: c.pinnedTier,
      archived: c.archived,
      availableTokens: brief ? brief.availableTokens : null,
      inheritedTokens: brief ? brief.briefTokens : null,
      prunedPct: brief ? brief.prunedPct : null,
      lastTier: lastTier(c),
    };
  });
}

export { prunedPct };
