import { isSafePersistedId, parseStoredConversation } from '../store-schema';
import type { Conversation } from '../types';
import {
  PersistenceSchemaError,
  PersistenceUnsupportedSchemaError,
} from './errors';

const MAX_MANIFEST_CONVERSATIONS = 10_000;

export interface ManifestV1 {
  schemaVersion: 1;
  revision: number;
  rootId: string;
  seq: number;
  conversations: Record<string, number>;
  conversationOrder: string[];
  inferenceLogStartBytes: number;
  inferenceLogBytes: number;
}

export interface ConversationEnvelopeV1 {
  schemaVersion: 1;
  conversationId: string;
  revision: number;
  conversation: Conversation;
}

export function parseManifestV1(value: unknown): ManifestV1 {
  const record = requireRecord(value, 'manifest');
  requireSchemaVersion(record.schemaVersion, 'manifest');
  const conversationsRecord = requireRecord(record.conversations, 'manifest conversations');
  if (Object.keys(conversationsRecord).length > MAX_MANIFEST_CONVERSATIONS) {
    fail('manifest conversation count exceeds safe bounds');
  }
  const conversationEntries: Array<[string, number]> = [];
  for (const [conversationId, revisionValue] of Object.entries(conversationsRecord)) {
    if (!isSafePersistedId(conversationId)) fail('manifest contains an unsafe conversation ID');
    conversationEntries.push([
      conversationId,
      requirePositiveInteger(revisionValue, `manifest conversation ${conversationId} revision`),
    ]);
  }
  const conversations = Object.fromEntries(conversationEntries);
  const conversationOrder = requireArray(record.conversationOrder, 'manifest conversationOrder').map(
    (conversationId) => requireId(conversationId, 'manifest conversationOrder ID'),
  );
  if (
    new Set(conversationOrder).size !== conversationOrder.length ||
    conversationOrder.length !== conversationEntries.length ||
    conversationOrder.some((conversationId) => !Object.hasOwn(conversations, conversationId))
  ) {
    fail('manifest conversationOrder must contain every conversation exactly once');
  }
  const rootId = requireId(record.rootId, 'manifest rootId');
  if (!Object.hasOwn(conversations, rootId)) fail('manifest rootId is not in conversations');
  const inferenceLogStartBytes = requireNonNegativeInteger(
    record.inferenceLogStartBytes,
    'manifest inferenceLogStartBytes',
  );
  const inferenceLogBytes = requireNonNegativeInteger(
    record.inferenceLogBytes,
    'manifest inferenceLogBytes',
  );
  if (!Number.isSafeInteger(inferenceLogStartBytes + inferenceLogBytes)) {
    fail('manifest inference log byte range is too large');
  }
  return {
    schemaVersion: 1,
    revision: requirePositiveInteger(record.revision, 'manifest revision'),
    rootId,
    seq: requireNonNegativeInteger(record.seq, 'manifest seq'),
    conversations,
    conversationOrder,
    inferenceLogStartBytes,
    inferenceLogBytes,
  };
}

export function parseConversationEnvelopeV1(
  value: unknown,
  filename: string,
): ConversationEnvelopeV1 {
  const expected = parseConversationFilename(filename);
  const record = requireRecord(value, 'conversation envelope');
  requireSchemaVersion(record.schemaVersion, 'conversation envelope');
  const conversationId = requireId(record.conversationId, 'conversation envelope ID');
  const revision = requirePositiveInteger(record.revision, 'conversation envelope revision');
  const conversation = parseStoredConversation(record.conversation, false);

  if (conversationId !== expected.conversationId || conversation.id !== conversationId) {
    fail('conversation envelope filename and IDs do not match');
  }
  if (revision !== expected.revision) {
    fail('conversation envelope filename and revision do not match');
  }
  return { schemaVersion: 1, conversationId, revision, conversation };
}

function parseConversationFilename(filename: string): {
  conversationId: string;
  revision: number;
} {
  const match = /^(.+)\.r([1-9]\d*)\.json$/.exec(filename);
  if (!match || !isSafePersistedId(match[1])) fail('conversation filename is invalid');
  return {
    conversationId: match[1],
    revision: requirePositiveInteger(Number(match[2]), 'conversation filename revision'),
  };
}

function requireSchemaVersion(value: unknown, label: string): void {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 1) {
    throw new PersistenceUnsupportedSchemaError(`${label} schemaVersion is unsupported`);
  }
  if (value !== 1) fail(`${label} schemaVersion must be 1`);
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

function requireId(value: unknown, label: string): string {
  if (!isSafePersistedId(value)) fail(`${label} must be a safe ID`);
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  const result = requireNonNegativeInteger(value, label);
  if (result === 0) fail(`${label} must be positive`);
  return result;
}

function fail(message: string): never {
  throw new PersistenceSchemaError(message);
}
