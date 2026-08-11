import { describe, expect, it } from 'vitest';
import { reconstructPath, type RawConversation } from '../src/claude-api';

// A conversation with an edit branch: message b2 was retried into b2b, and the current leaf is on
// the b2b branch, so the reconstructed path must include b2b and exclude the abandoned b2.
const raw: RawConversation = {
  uuid: 'conv-1',
  name: 'Berkeley clubs',
  current_leaf_message_uuid: 'a2',
  chat_messages: [
    { uuid: 'u1', parent_message_uuid: null, sender: 'human', content: [{ type: 'text', text: 'Which clubs?' }] },
    { uuid: 'b2', parent_message_uuid: 'u1', sender: 'assistant', content: [{ type: 'text', text: 'first draft answer' }] },
    { uuid: 'b2b', parent_message_uuid: 'u1', sender: 'assistant', content: [{ type: 'text', text: 'Free Ventures, ML@B, Blueprint.' }] },
    { uuid: 'u2', parent_message_uuid: 'b2b', sender: 'human', content: [{ type: 'text', text: 'Deadlines?' }] },
    { uuid: 'a2', parent_message_uuid: 'u2', sender: 'assistant', content: [{ type: 'text', text: 'Free Ventures closes September 11.' }] },
  ],
};

describe('reconstructPath', () => {
  it('walks the active branch from the current leaf and drops abandoned siblings', () => {
    const tree = reconstructPath(raw);
    expect(tree.path.map((t) => t.uuid)).toEqual(['u1', 'b2b', 'u2', 'a2']);
    expect(tree.path.some((t) => t.uuid === 'b2')).toBe(false);
  });

  it('maps sender to role and joins text blocks', () => {
    const tree = reconstructPath(raw);
    expect(tree.path[0]).toMatchObject({ role: 'user', text: 'Which clubs?' });
    expect(tree.path[3]).toMatchObject({ role: 'assistant', text: 'Free Ventures closes September 11.' });
  });

  it('falls back to document order when there is no leaf pointer', () => {
    const noLeaf: RawConversation = { ...raw, current_leaf_message_uuid: undefined };
    const tree = reconstructPath(noLeaf);
    expect(tree.path.length).toBe(5);
    expect(tree.path[0].uuid).toBe('u1');
  });

  it('drops empty messages', () => {
    const withEmpty: RawConversation = {
      uuid: 'c',
      name: 'x',
      current_leaf_message_uuid: 'm2',
      chat_messages: [
        { uuid: 'm1', parent_message_uuid: null, sender: 'human', content: [] },
        { uuid: 'm2', parent_message_uuid: 'm1', sender: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      ],
    };
    expect(reconstructPath(withEmpty).path.map((t) => t.uuid)).toEqual(['m2']);
  });
});
