import { describe, expect, it } from 'vitest';
import { PersistenceSchemaError } from './errors';
import { parseConversationEnvelopeV1, parseManifestV1 } from './schema';

function manifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    revision: 4,
    rootId: 'root-main',
    seq: 12,
    conversations: {
      'root-main': 4,
      'independent-root': 2,
    },
    conversationOrder: ['root-main', 'independent-root'],
    inferenceLogStartBytes: 24,
    inferenceLogBytes: 80,
  };
}

function envelope(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    conversationId: 'root-main',
    revision: 4,
    conversation: {
      id: 'root-main',
      title: 'Root',
      parentId: null,
      messages: [],
      insights: [],
      pinnedTier: null,
      archived: false,
    },
  };
}

describe('parseManifestV1', () => {
  it('parses Manifest V1 without mutating input', () => {
    const input = manifest();
    const before = structuredClone(input);

    const parsed = parseManifestV1(input);

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(input).toEqual(before);
  });

  it.each([
    ['a future schema', (value: Record<string, unknown>) => (value.schemaVersion = 2)],
    ['a missing primary root', (value: Record<string, unknown>) => (value.rootId = 'missing')],
    [
      'an unsafe conversation ID',
      (value: Record<string, unknown>) => {
        value.conversations = { '../escape': 4 };
        value.rootId = '../escape';
      },
    ],
    [
      'a prototype-reserved conversation ID',
      (value: Record<string, unknown>) => {
        value.conversations = { constructor: 4 };
        value.rootId = 'constructor';
      },
    ],
    [
      'a non-positive conversation revision',
      (value: Record<string, unknown>) => {
        value.conversations = { 'root-main': 0 };
      },
    ],
    [
      'an incomplete conversation order',
      (value: Record<string, unknown>) => {
        value.conversationOrder = ['root-main'];
      },
    ],
    [
      'a duplicate conversation order entry',
      (value: Record<string, unknown>) => {
        value.conversationOrder = ['root-main', 'root-main'];
      },
    ],
    ['a negative log offset', (value: Record<string, unknown>) => (value.inferenceLogStartBytes = -1)],
  ])('rejects %s without mutating input', (_name, mutate) => {
    const input = manifest();
    mutate(input);
    const before = structuredClone(input);

    expect(() => parseManifestV1(input)).toThrow(PersistenceSchemaError);
    expect(input).toEqual(before);
  });
});

describe('parseConversationEnvelopeV1', () => {
  it('parses a matching V1 conversation envelope without mutating input', () => {
    const input = envelope();
    const before = structuredClone(input);

    const parsed = parseConversationEnvelopeV1(input, 'root-main.r4.json');

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.conversation).not.toBe(input.conversation);
    expect(input).toEqual(before);
  });

  it.each([
    ['a future schema', (value: Record<string, unknown>) => (value.schemaVersion = 2), 'root-main.r4.json'],
    ['a filename ID mismatch', () => undefined, 'other.r4.json'],
    [
      'an envelope ID mismatch',
      (value: Record<string, unknown>) => (value.conversationId = 'other'),
      'root-main.r4.json',
    ],
    [
      'a conversation ID mismatch',
      (value: Record<string, unknown>) => {
        const conversation = value.conversation as Record<string, unknown>;
        conversation.id = 'other';
      },
      'root-main.r4.json',
    ],
    [
      'a revision mismatch',
      (value: Record<string, unknown>) => (value.revision = 3),
      'root-main.r4.json',
    ],
    ['an unsafe filename', () => undefined, '../root-main.r4.json'],
  ])('rejects %s without mutating input', (_name, mutate, filename) => {
    const input = envelope();
    mutate(input);
    const before = structuredClone(input);

    expect(() => parseConversationEnvelopeV1(input, filename)).toThrow(PersistenceSchemaError);
    expect(input).toEqual(before);
  });
});
