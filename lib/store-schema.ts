import { PersistenceSchemaError } from './persistence/errors';
import type {
  ContextBrief,
  ContextSourceKind,
  ContextSourceRef,
  Conversation,
  Effort,
  FactProvenanceStatus,
  InferenceLog,
  InferencePurpose,
  Insight,
  Message,
  RoutingDecision,
  Tier,
  UserProfile,
} from './types';

const MAX_ID_LENGTH = 160;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);

export type LegacyContextBrief = Omit<
  ContextBrief,
  'sourceRefs' | 'factSourceIds' | 'factProvenance'
> &
  Partial<Pick<ContextBrief, 'sourceRefs' | 'factSourceIds' | 'factProvenance'>>;

export type LegacyInsight = Omit<Insight, 'sourceMessageIds' | 'active'> &
  Partial<Pick<Insight, 'sourceMessageIds' | 'active'>>;

export type StoredConversation = Omit<Conversation, 'brief' | 'insights'> & {
  brief?: LegacyContextBrief;
  insights: LegacyInsight[];
};

export type LegacyInferenceLog = Omit<InferenceLog, 'status'> &
  Partial<Pick<InferenceLog, 'status'>>;

export interface SeedTree {
  rootInsights?: LegacyInsight[];
  branches?: StoredConversation[];
  logs?: LegacyInferenceLog[];
  seq?: number;
}

export interface StoreSnapshot {
  conversations: Conversation[];
  logs: InferenceLog[];
  rootId: string;
  seq: number;
}

export function isSafePersistedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    ID_PATTERN.test(value) &&
    !RESERVED_IDS.has(value)
  );
}

export function normalizeBrief(brief: LegacyContextBrief): ContextBrief {
  const factSourceIds =
    brief.factSourceIds?.map((sourceIds) => [...sourceIds]) ?? brief.facts.map(() => []);
  return {
    id: brief.id,
    branchId: brief.branchId,
    selection: brief.selection,
    markdown: brief.markdown,
    facts: [...brief.facts],
    excludedNote: brief.excludedNote,
    availableTokens: brief.availableTokens,
    briefTokens: brief.briefTokens,
    prunedPct: brief.prunedPct,
    sourceRefs: brief.sourceRefs?.map((source) => ({ ...source })) ?? [],
    factSourceIds,
    factProvenance:
      brief.factProvenance?.map((status) => status) ?? brief.facts.map(() => 'legacy-unknown'),
  };
}

export function normalizeInsight(insight: LegacyInsight): Insight {
  return {
    id: insight.id,
    branchId: insight.branchId,
    parentId: insight.parentId,
    text: insight.text,
    createdAt: insight.createdAt,
    sourceMessageIds: [...(insight.sourceMessageIds ?? [])],
    active: insight.active ?? true,
  };
}

export function normalizeStoredConversation(conversation: StoredConversation): Conversation {
  return {
    id: conversation.id,
    title: conversation.title,
    parentId: conversation.parentId,
    ...(conversation.profile ? { profile: cloneProfile(conversation.profile) } : {}),
    messages: conversation.messages.map(cloneMessage),
    ...(conversation.brief ? { brief: normalizeBrief(conversation.brief) } : {}),
    insights: conversation.insights.map(normalizeInsight),
    pinnedTier: conversation.pinnedTier,
    archived: conversation.archived,
  };
}

export function normalizeInferenceLog(log: LegacyInferenceLog): InferenceLog {
  return {
    id: log.id,
    ts: log.ts,
    branchId: log.branchId,
    purpose: log.purpose,
    tier: log.tier,
    model: log.model,
    ...(log.servedBy === undefined ? {} : { servedBy: log.servedBy }),
    ...(log.effort === undefined ? {} : { effort: log.effort }),
    inputTokens: log.inputTokens,
    outputTokens: log.outputTokens,
    estCostUsd: log.estCostUsd,
    status: log.status ?? 'succeeded',
    escalated: log.escalated,
    overridden: log.overridden,
    baselineInputTokens: log.baselineInputTokens,
    baselineCostUsd: log.baselineCostUsd,
  };
}

export function parseStoreSnapshot(value: unknown): StoreSnapshot {
  const record = requireRecord(value, 'store snapshot');
  const conversationsValue = requireArray(record.conversations, 'conversations');
  if (conversationsValue.length === 0) fail('conversations must not be empty');
  const conversations = conversationsValue.map((conversation) =>
    parseStoredConversation(conversation, true),
  );
  const logs = requireArray(record.logs, 'logs').map((log) => parseInferenceLog(log, true));
  const rootId = requireId(record.rootId, 'rootId');
  const seq = requireNonNegativeInteger(record.seq, 'seq');
  const snapshot = { conversations, logs, rootId, seq };

  validateSnapshotRelationships(snapshot);
  return snapshot;
}

export function parseStoredConversation(value: unknown, allowLegacy = false): Conversation {
  const record = requireRecord(value, 'conversation');
  const id = requireId(record.id, 'conversation.id');
  const parentId =
    record.parentId === null ? null : requireId(record.parentId, `conversation ${id} parentId`);
  const profile =
    record.profile === undefined ? undefined : parseUserProfile(record.profile, `conversation ${id}`);
  const messages = requireArray(record.messages, `conversation ${id} messages`).map((message) =>
    parseMessage(message, id),
  );
  const brief =
    record.brief === undefined ? undefined : parseBrief(record.brief, id, allowLegacy);
  const insights = requireArray(record.insights, `conversation ${id} insights`).map((insight) =>
    parseInsight(insight, id, allowLegacy),
  );
  const pinnedTier = record.pinnedTier === null ? null : requireTier(record.pinnedTier, 'pinnedTier');
  if (typeof record.archived !== 'boolean') fail(`conversation ${id} archived must be a boolean`);

  const conversation: Conversation = {
    id,
    title: requireNonEmptyString(record.title, `conversation ${id} title`),
    parentId,
    ...(profile ? { profile } : {}),
    messages,
    ...(brief ? { brief } : {}),
    insights,
    pinnedTier,
    archived: record.archived,
  };
  validateConversationLocalRelationships(conversation);
  return conversation;
}

function parseUserProfile(value: unknown, label: string): UserProfile {
  const record = requireRecord(value, `${label} profile`);
  const goals = requireArray(record.goals, `${label} profile goals`);
  if (!goals.every((goal) => typeof goal === 'string')) {
    fail(`${label} profile goals must contain strings`);
  }
  return {
    name: requireNonEmptyString(record.name, `${label} profile name`),
    context: requireString(record.context, `${label} profile context`),
    goals: [...(goals as string[])],
  };
}

function parseMessage(value: unknown, conversationId: string): Message {
  const record = requireRecord(value, `message in ${conversationId}`);
  const id = requireId(record.id, `message in ${conversationId} id`);
  if (record.role !== 'user' && record.role !== 'assistant') {
    fail(`message ${id} role is invalid`);
  }
  if (record.createdAt !== undefined && typeof record.createdAt !== 'string') {
    fail(`message ${id} createdAt must be a string`);
  }
  return {
    id,
    role: record.role,
    content: requireNonEmptyString(record.content, `message ${id} content`),
    ...(record.routing === undefined ? {} : { routing: parseRouting(record.routing, id) }),
    ...(record.createdAt === undefined ? {} : { createdAt: record.createdAt }),
  };
}

function parseRouting(value: unknown, messageId: string): RoutingDecision {
  const record = requireRecord(value, `message ${messageId} routing`);
  const complexity = record.complexity;
  if (complexity !== 1 && complexity !== 2 && complexity !== 3) {
    fail(`message ${messageId} routing complexity is invalid`);
  }
  if (typeof record.escalated !== 'boolean' || typeof record.overridden !== 'boolean') {
    fail(`message ${messageId} routing flags must be booleans`);
  }
  return {
    tier: requireTier(record.tier, 'routing tier'),
    model: requireNonEmptyString(record.model, 'routing model'),
    ...(record.effort === undefined ? {} : { effort: requireEffort(record.effort, 'routing effort') }),
    ...(record.modelLabel === undefined
      ? {}
      : { modelLabel: requireString(record.modelLabel, 'routing modelLabel') }),
    ...(record.label === undefined ? {} : { label: requireString(record.label, 'routing label') }),
    ...(record.servedBy === undefined
      ? {}
      : { servedBy: requireNonEmptyString(record.servedBy, 'routing servedBy') }),
    effortNote: requireNonEmptyString(record.effortNote, 'routing effortNote'),
    contextTokens: requireNonNegativeNumber(record.contextTokens, 'routing contextTokens'),
    estCostUsd: requireNonNegativeNumber(record.estCostUsd, 'routing estCostUsd'),
    reason: requireNonEmptyString(record.reason, 'routing reason'),
    complexity,
    escalated: record.escalated,
    overridden: record.overridden,
  };
}

function parseBrief(value: unknown, conversationId: string, allowLegacy: boolean): ContextBrief {
  const record = requireRecord(value, `conversation ${conversationId} brief`);
  const facts = requireArray(record.facts, `conversation ${conversationId} brief facts`);
  if (!facts.every((fact) => typeof fact === 'string')) {
    fail(`conversation ${conversationId} brief facts must contain strings`);
  }
  const sourceRefs = parseOptionalSourceRefs(record.sourceRefs, conversationId, allowLegacy);
  const factSourceIds = parseOptionalFactSourceIds(
    record.factSourceIds,
    facts.length,
    sourceRefs,
    conversationId,
    allowLegacy,
  );
  const factProvenance = parseOptionalFactProvenance(
    record.factProvenance,
    facts.length,
    conversationId,
    allowLegacy,
  );
  factProvenance.forEach((status, index) => {
    if (status !== 'legacy-unknown' && factSourceIds[index].length === 0) {
      fail(`conversation ${conversationId} fact ${index} has provenance without a source`);
    }
  });

  return {
    id: requireId(record.id, `conversation ${conversationId} brief id`),
    branchId: requireId(record.branchId, `conversation ${conversationId} brief branchId`),
    selection: requireString(record.selection, `conversation ${conversationId} brief selection`),
    markdown: requireString(record.markdown, `conversation ${conversationId} brief markdown`),
    facts: [...(facts as string[])],
    excludedNote: requireString(
      record.excludedNote,
      `conversation ${conversationId} brief excludedNote`,
    ),
    availableTokens: requireNonNegativeNumber(
      record.availableTokens,
      `conversation ${conversationId} brief availableTokens`,
    ),
    briefTokens: requireNonNegativeNumber(
      record.briefTokens,
      `conversation ${conversationId} brief briefTokens`,
    ),
    prunedPct: requirePercentage(record.prunedPct, `conversation ${conversationId} brief prunedPct`),
    sourceRefs,
    factSourceIds,
    factProvenance,
  };
}

function parseOptionalSourceRefs(
  value: unknown,
  conversationId: string,
  allowLegacy: boolean,
): ContextSourceRef[] {
  if (value === undefined) {
    if (!allowLegacy) fail(`conversation ${conversationId} brief sourceRefs are required`);
    return [];
  }
  const refs = requireArray(value, `conversation ${conversationId} brief sourceRefs`).map(
    (source): ContextSourceRef => {
      const record = requireRecord(source, `conversation ${conversationId} source reference`);
      return {
        kind: requireContextSourceKind(record.kind),
        conversationId: requireId(record.conversationId, 'source conversationId'),
        sourceId: requireId(record.sourceId, 'source sourceId'),
      };
    },
  );
  requireUnique(
    refs.map(({ sourceId }) => sourceId),
    `conversation ${conversationId} source IDs`,
  );
  return refs;
}

function parseOptionalFactSourceIds(
  value: unknown,
  factCount: number,
  sourceRefs: ContextSourceRef[],
  conversationId: string,
  allowLegacy: boolean,
): string[][] {
  if (value === undefined) {
    if (!allowLegacy) fail(`conversation ${conversationId} brief factSourceIds are required`);
    return Array.from({ length: factCount }, () => []);
  }
  const rows = requireArray(value, `conversation ${conversationId} brief factSourceIds`);
  if (rows.length !== factCount) {
    fail(`conversation ${conversationId} brief factSourceIds must align with facts`);
  }
  const knownSourceIds = new Set(sourceRefs.map(({ sourceId }) => sourceId));
  return rows.map((row, index) => {
    const sourceIds = requireArray(row, `conversation ${conversationId} fact ${index} sources`).map(
      (sourceId) => requireId(sourceId, `conversation ${conversationId} fact source ID`),
    );
    requireUnique(sourceIds, `conversation ${conversationId} fact ${index} source IDs`);
    if (sourceIds.some((sourceId) => !knownSourceIds.has(sourceId))) {
      fail(`conversation ${conversationId} fact ${index} cites an unknown source`);
    }
    return sourceIds;
  });
}

function parseOptionalFactProvenance(
  value: unknown,
  factCount: number,
  conversationId: string,
  allowLegacy: boolean,
): FactProvenanceStatus[] {
  if (value === undefined) {
    if (!allowLegacy) fail(`conversation ${conversationId} brief factProvenance is required`);
    return Array.from({ length: factCount }, () => 'legacy-unknown');
  }
  const statuses = requireArray(value, `conversation ${conversationId} brief factProvenance`);
  if (statuses.length !== factCount) {
    fail(`conversation ${conversationId} brief factProvenance must align with facts`);
  }
  return statuses.map((status) => requireFactProvenance(status));
}

function parseInsight(
  value: unknown,
  conversationId: string,
  allowLegacy: boolean,
): Insight {
  const record = requireRecord(value, `insight in ${conversationId}`);
  const id = requireId(record.id, `insight in ${conversationId} id`);
  let sourceMessageIds: string[];
  if (record.sourceMessageIds === undefined) {
    if (!allowLegacy) fail(`insight ${id} sourceMessageIds are required`);
    sourceMessageIds = [];
  } else {
    sourceMessageIds = requireArray(record.sourceMessageIds, `insight ${id} sourceMessageIds`).map(
      (sourceId) => requireId(sourceId, `insight ${id} source message ID`),
    );
    requireUnique(sourceMessageIds, `insight ${id} sourceMessageIds`);
  }
  let active: boolean;
  if (record.active === undefined) {
    if (!allowLegacy) fail(`insight ${id} active is required`);
    active = true;
  } else {
    if (typeof record.active !== 'boolean') fail(`insight ${id} active must be a boolean`);
    active = record.active;
  }
  return {
    id,
    branchId: requireId(record.branchId, `insight ${id} branchId`),
    parentId: requireId(record.parentId, `insight ${id} parentId`),
    text: requireNonEmptyString(record.text, `insight ${id} text`),
    createdAt: requireNonEmptyString(record.createdAt, `insight ${id} createdAt`),
    sourceMessageIds,
    active,
  };
}

function parseInferenceLog(value: unknown, allowLegacy: boolean): InferenceLog {
  const record = requireRecord(value, 'inference log');
  const id = requireId(record.id, 'inference log id');
  let status: 'succeeded' | 'failed';
  if (record.status === undefined) {
    if (!allowLegacy) fail(`inference log ${id} status is required`);
    status = 'succeeded';
  } else if (record.status === 'succeeded' || record.status === 'failed') {
    status = record.status;
  } else {
    fail(`inference log ${id} status is invalid`);
  }
  if (typeof record.escalated !== 'boolean' || typeof record.overridden !== 'boolean') {
    fail(`inference log ${id} routing flags must be booleans`);
  }
  return {
    id,
    ts: requireNonEmptyString(record.ts, `inference log ${id} timestamp`),
    branchId: requireId(record.branchId, `inference log ${id} branchId`),
    purpose: requireInferencePurpose(record.purpose),
    tier: requireTier(record.tier, 'inference tier'),
    model: requireNonEmptyString(record.model, `inference log ${id} model`),
    ...(record.servedBy === undefined
      ? {}
      : { servedBy: requireNonEmptyString(record.servedBy, `inference log ${id} servedBy`) }),
    ...(record.effort === undefined
      ? {}
      : { effort: requireEffort(record.effort, `inference log ${id} effort`) }),
    inputTokens: requireNonNegativeNumber(record.inputTokens, `inference log ${id} inputTokens`),
    outputTokens: requireNonNegativeNumber(record.outputTokens, `inference log ${id} outputTokens`),
    estCostUsd: requireNonNegativeNumber(record.estCostUsd, `inference log ${id} estCostUsd`),
    status,
    escalated: record.escalated,
    overridden: record.overridden,
    baselineInputTokens: requireNonNegativeNumber(
      record.baselineInputTokens,
      `inference log ${id} baselineInputTokens`,
    ),
    baselineCostUsd: requireNonNegativeNumber(
      record.baselineCostUsd,
      `inference log ${id} baselineCostUsd`,
    ),
  };
}

function validateConversationLocalRelationships(conversation: Conversation): void {
  const isRoot = conversation.parentId === null;
  const hasBrief = conversation.brief !== undefined;
  if (isRoot === hasBrief) {
    fail(`conversation ${conversation.id} has an invalid root/brief relationship`);
  }
  if (conversation.brief && conversation.brief.branchId !== conversation.id) {
    fail(`conversation ${conversation.id} brief belongs to a different branch`);
  }
  for (const insight of conversation.insights) {
    if (insight.parentId !== conversation.id) {
      fail(`insight ${insight.id} belongs to a different parent`);
    }
  }
  requireUnique(
    conversation.messages.map(({ id }) => id),
    `conversation ${conversation.id} message IDs`,
  );
  requireUnique(
    conversation.insights.map(({ id }) => id),
    `conversation ${conversation.id} insight IDs`,
  );
}

function validateSnapshotRelationships(snapshot: StoreSnapshot): void {
  const byId = new Map(snapshot.conversations.map((conversation) => [conversation.id, conversation]));
  if (byId.size !== snapshot.conversations.length) fail('conversation IDs must be unique');
  if (byId.get(snapshot.rootId)?.parentId !== null) fail('rootId must identify a root conversation');
  validateForest(snapshot.conversations, byId);
  validateEntityIds(snapshot);

  for (const conversation of snapshot.conversations) {
    if (conversation.brief) validateBriefEvidence(conversation, byId);
    for (const insight of conversation.insights) validateInsightEvidence(insight, conversation, byId);
  }
  if (snapshot.seq < maxGeneratedSequence(snapshot)) {
    fail('seq is lower than a generated persisted ID');
  }
}

function validateForest(
  conversations: Conversation[],
  byId: ReadonlyMap<string, Conversation>,
): void {
  for (const conversation of conversations) {
    const visited = new Set<string>();
    let cursor: Conversation = conversation;
    while (cursor.parentId !== null) {
      if (visited.has(cursor.id)) fail(`conversation ${conversation.id} is in a parent cycle`);
      visited.add(cursor.id);
      const parent = byId.get(cursor.parentId);
      if (!parent) fail(`conversation ${conversation.id} has an orphan parent`);
      cursor = parent;
    }
  }
}

function validateEntityIds(snapshot: StoreSnapshot): void {
  const ids: string[] = [];
  for (const conversation of snapshot.conversations) {
    ids.push(conversation.id, ...conversation.messages.map(({ id }) => id));
    if (conversation.brief) ids.push(conversation.brief.id);
    ids.push(...conversation.insights.map(({ id }) => id));
  }
  ids.push(...snapshot.logs.map(({ id }) => id));
  requireUnique(ids, 'persisted entity IDs');
}

function validateBriefEvidence(
  owner: Conversation,
  conversations: ReadonlyMap<string, Conversation>,
): void {
  const brief = owner.brief!;
  const parent = conversations.get(owner.parentId!);
  if (!parent) fail(`brief ${brief.id} has no parent conversation`);
  const allowedSources = new Set([
    ...visibleSourceRefs(parent).map(sourceRefKey),
    sourceRefKey({
      kind: 'selection',
      conversationId: owner.id,
      sourceId: `selection:${owner.id}`,
    }),
    sourceRefKey({
      kind: 'question',
      conversationId: owner.id,
      sourceId: `question:${owner.id}`,
    }),
  ]);
  for (const source of brief.sourceRefs) {
    if (!allowedSources.has(sourceRefKey(source))) {
      fail(`brief ${brief.id} references evidence outside its parent-visible context`);
    }
  }
}

function visibleSourceRefs(conversation: Conversation): ContextSourceRef[] {
  const inherited: ContextSourceRef[] =
    conversation.parentId === null
      ? conversation.profile
        ? [
            {
              kind: 'profile',
              conversationId: conversation.id,
              sourceId: `profile:${conversation.id}`,
            },
          ]
        : []
      : conversation.brief
        ? [
            {
              kind: 'brief',
              conversationId: conversation.id,
              sourceId: conversation.brief.id,
            },
          ]
        : [];
  return [
    ...inherited,
    ...conversation.messages.map(({ id }) => ({
      kind: 'message' as const,
      conversationId: conversation.id,
      sourceId: id,
    })),
    ...conversation.insights
      .filter(({ active }) => active)
      .map(({ id }) => ({
        kind: 'insight' as const,
        conversationId: conversation.id,
        sourceId: id,
      })),
  ];
}

function sourceRefKey(source: ContextSourceRef): string {
  return `${source.kind}\0${source.conversationId}\0${source.sourceId}`;
}

function validateInsightEvidence(
  insight: Insight,
  parent: Conversation,
  conversations: ReadonlyMap<string, Conversation>,
): void {
  const branch = conversations.get(insight.branchId);
  if (!branch || branch.parentId !== parent.id) {
    fail(`insight ${insight.id} references an invalid source branch`);
  }
  const branchMessageIds = new Set(branch.messages.map(({ id }) => id));
  if (insight.sourceMessageIds.some((sourceId) => !branchMessageIds.has(sourceId))) {
    fail(`insight ${insight.id} references evidence outside its source branch`);
  }
}

function maxGeneratedSequence(snapshot: StoreSnapshot): number {
  const ids = snapshot.conversations.flatMap((conversation) => [
    conversation.id,
    ...(conversation.brief ? [conversation.brief.id] : []),
    ...conversation.messages.map(({ id }) => id),
    ...conversation.insights.map(({ id }) => id),
  ]);
  ids.push(...snapshot.logs.flatMap(({ id, branchId }) => [id, branchId]));
  return ids.reduce((max, id) => {
    const suffix = /_(\d+)$/.exec(id)?.[1];
    if (!suffix) return max;
    const sequence = Number(suffix);
    if (!Number.isSafeInteger(sequence)) fail(`persisted ID ${id} has an unsafe numeric suffix`);
    return Math.max(max, sequence);
  }, 0);
}

function cloneProfile(profile: UserProfile): UserProfile {
  return { name: profile.name, context: profile.context, goals: [...profile.goals] };
}

function cloneMessage(message: Message): Message {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.routing ? { routing: { ...message.routing } } : {}),
    ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt }),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} must be a string`);
  return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
  const result = requireString(value, label);
  if (result.length === 0) fail(`${label} must not be empty`);
  return result;
}

function requireId(value: unknown, label: string): string {
  if (!isSafePersistedId(value)) fail(`${label} must be a safe ID`);
  return value;
}

function requireNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${label} must be a non-negative finite number`);
  }
  return value;
}

function requirePercentage(value: unknown, label: string): number {
  const result = requireNonNegativeNumber(value, label);
  if (result > 100) fail(`${label} must be at most 100`);
  return result;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function requireTier(value: unknown, label: string): Tier {
  if (value !== 'quick' && value !== 'thoughtful' && value !== 'deep') {
    fail(`${label} is invalid`);
  }
  return value;
}

function requireEffort(value: unknown, label: string): Effort {
  if (value !== 'low' && value !== 'medium' && value !== 'high' && value !== 'max') {
    fail(`${label} is invalid`);
  }
  return value;
}

function requireInferencePurpose(value: unknown): InferencePurpose {
  if (value !== 'chat' && value !== 'compile' && value !== 'classify' && value !== 'merge') {
    fail('inference purpose is invalid');
  }
  return value;
}

function requireContextSourceKind(value: unknown): ContextSourceKind {
  if (
    value !== 'profile' &&
    value !== 'brief' &&
    value !== 'message' &&
    value !== 'insight' &&
    value !== 'selection' &&
    value !== 'question'
  ) {
    fail('context source kind is invalid');
  }
  return value;
}

function requireFactProvenance(value: unknown): FactProvenanceStatus {
  if (value !== 'model-cited' && value !== 'extractive' && value !== 'legacy-unknown') {
    fail('fact provenance is invalid');
  }
  return value;
}

function requireUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`${label} must be unique`);
}

function fail(message: string): never {
  throw new PersistenceSchemaError(message);
}
