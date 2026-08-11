import { describe, expect, it } from 'vitest';
import { assemblePath, profileFor, renderChatContext, widenedChatContext } from '../src/context';
import { estimateTokens, messagesTokens } from '../src/tokens';
import type { ContextBrief, Conversation, Insight, Message, UserProfile } from '../src/types';
import type { ConversationLookup } from '../src/tree';

const profile: UserProfile = {
  name: 'Tarun',
  context: 'Berkeley freshman.',
  goals: ['ship Bonsai'],
};

function msg(id: string, role: 'user' | 'assistant', content: string): Message {
  return { id, role, content };
}

function convo(overrides: Partial<Conversation> & { id: string }): Conversation {
  return {
    title: overrides.id,
    parentId: null,
    messages: [],
    insights: [],
    pinnedTier: null,
    archived: false,
    ...overrides,
  };
}

function briefFor(branchId: string, anchorMessageId?: string): ContextBrief {
  return {
    id: `brief-${branchId}`,
    branchId,
    selection: 'Free Ventures',
    markdown: '# Branch brief — Free Ventures\n\n## Relevant facts\n- Applications close September 11.',
    facts: ['Applications close September 11.'],
    excludedNote: 'Excluded: everything else.',
    availableTokens: 4000,
    briefTokens: 60,
    prunedPct: 98.5,
    ...(anchorMessageId ? { anchorMessageId } : {}),
  };
}

function insight(id: string, text: string): Insight {
  return { id, branchId: 'b1', parentId: 'parent', text, createdAt: '2026-08-10T00:00:00Z' };
}

function lookup(all: Conversation[]): ConversationLookup {
  return (id) => all.find((c) => c.id === id);
}

describe('profileFor', () => {
  const root = convo({ id: 'root', profile });
  const mid = convo({ id: 'mid', parentId: 'root' });
  const leaf = convo({ id: 'leaf', parentId: 'mid' });
  const byId = lookup([root, mid, leaf]);

  it('returns the conversation\'s own profile first', () => {
    const selfProfile: UserProfile = { name: 'Other', context: 'Own.', goals: [] };
    expect(profileFor(convo({ id: 'self', parentId: 'root', profile: selfProfile }), byId)).toBe(
      selfProfile,
    );
  });

  it('walks to the nearest ancestor with a profile', () => {
    expect(profileFor(mid, byId)).toBe(profile);
    expect(profileFor(leaf, byId)).toBe(profile);
  });

  it('is undefined when no ancestor carries one', () => {
    const bareRoot = convo({ id: 'bare' });
    const bareLeaf = convo({ id: 'bare-leaf', parentId: 'bare' });
    expect(profileFor(bareLeaf, lookup([bareRoot, bareLeaf]))).toBeUndefined();
  });
});

describe('assemblePath', () => {
  const messages = [
    msg('m1', 'user', 'Which clubs should I join this fall?'),
    msg('m2', 'assistant', 'Free Ventures, ML@B, and Blueprint are worth weighing.'),
    msg('m3', 'user', 'What about consulting clubs?'),
    msg('m4', 'assistant', 'Berkeley Consulting was ruled out for its case interviews.'),
  ];
  const parent = convo({
    id: 'parent',
    parentId: 'root',
    brief: briefFor('parent'),
    insights: [insight('i1', 'Free Ventures beats Blueprint for builder hours.')],
    messages,
  });
  const byId = lookup([parent]);

  it('renders inherited context, learned insights, and the conversation in order', () => {
    const path = assemblePath({ parent, byId });
    expect(path.markdown).toContain(
      '## Inherited context (compiled when this conversation was forked)\n# Branch brief — Free Ventures',
    );
    expect(path.markdown).toContain(
      '## Learned from branches\n- Free Ventures beats Blueprint for builder hours.',
    );
    expect(path.markdown).toContain(
      '## Conversation\nuser: Which clubs should I join this fall?\n\nassistant: Free Ventures, ML@B, and Blueprint are worth weighing.',
    );
    expect(path.markdown.indexOf('## Inherited context')).toBeLessThan(
      path.markdown.indexOf('## Learned from branches'),
    );
    expect(path.markdown.indexOf('## Learned from branches')).toBeLessThan(
      path.markdown.indexOf('## Conversation'),
    );
    expect(path.tokens).toBe(estimateTokens(path.markdown));
    expect(path.scopedMessages).toEqual(messages);
  });

  it('omits the inherited and learned sections on a plain parent', () => {
    const plain = convo({ id: 'plain', messages: messages.slice(0, 2) });
    const path = assemblePath({ parent: plain, byId: lookup([plain]) });
    expect(path.markdown).not.toContain('## Inherited context');
    expect(path.markdown).not.toContain('## Learned from branches');
    expect(path.markdown.startsWith('## Conversation\n')).toBe(true);
  });

  it('truncates messages after the anchor, keeping the anchor itself', () => {
    const path = assemblePath({ parent, byId, anchorMessageId: 'm2' });
    expect(path.scopedMessages).toEqual(messages.slice(0, 2));
    expect(path.markdown).toContain('assistant: Free Ventures, ML@B, and Blueprint are worth weighing.');
    expect(path.markdown).not.toContain('What about consulting clubs?');
    expect(path.markdown).not.toContain('Berkeley Consulting');
    expect(path.tokens).toBe(estimateTokens(path.markdown));
  });

  it('scopes to empty on an unknown anchor id — fail closed, never leak the full transcript', () => {
    const path = assemblePath({ parent, byId, anchorMessageId: 'ghost' });
    expect(path.scopedMessages).toEqual([]);
    expect(path.markdown).not.toContain('Berkeley Consulting');
  });
});

describe('renderChatContext', () => {
  const turns = [
    msg('m1', 'user', 'Which clubs should I join this fall?'),
    msg('m2', 'assistant', 'Free Ventures, ML@B, and Blueprint are worth weighing.'),
  ];
  const transcript =
    'user: Which clubs should I join this fall?\n\nassistant: Free Ventures, ML@B, and Blueprint are worth weighing.';

  it('renders a root as its bare transcript', () => {
    const root = convo({ id: 'root', messages: turns });
    const { context, contextTokens } = renderChatContext(root);
    expect(context).toBe(transcript);
    expect(contextTokens).toBe(estimateTokens(context));
  });

  it('prepends the insights section on a root that has them', () => {
    const root = convo({
      id: 'root',
      messages: turns,
      insights: [insight('i1', 'Free Ventures beats Blueprint for builder hours.')],
    });
    const { context } = renderChatContext(root);
    expect(context).toBe(
      `## Learned from branches\n- Free Ventures beats Blueprint for builder hours.\n\n${transcript}`,
    );
    expect(context).not.toContain('## This branch so far');
  });

  it('renders a branch as brief markdown, insights, and this-branch-so-far', () => {
    const branch = convo({
      id: 'b1',
      parentId: 'parent',
      brief: briefFor('b1'),
      insights: [insight('i1', 'Free Ventures beats Blueprint for builder hours.')],
      messages: [msg('b1m1', 'user', 'When do applications close?')],
    });
    const { context, contextTokens } = renderChatContext(branch);
    expect(context).toBe(
      [
        briefFor('b1').markdown,
        '## Learned from branches\n- Free Ventures beats Blueprint for builder hours.',
        '## This branch so far\nuser: When do applications close?',
      ].join('\n\n'),
    );
    expect(contextTokens).toBe(estimateTokens(context));
  });
});

describe('widenedChatContext', () => {
  const parentMessages = [
    msg('p1', 'user', 'Which clubs should I join this fall?'),
    msg('p2', 'assistant', 'Free Ventures, ML@B, and Blueprint are worth weighing.'),
    msg('p3', 'user', 'What about consulting clubs?'),
    msg('p4', 'assistant', 'Berkeley Consulting was ruled out for its case interviews.'),
  ];
  const parent = convo({ id: 'parent', messages: parentMessages });

  it('returns null for a root', () => {
    const root = convo({ id: 'root', messages: parentMessages });
    expect(widenedChatContext(root, lookup([root]))).toBeNull();
  });

  it('returns null for a briefless node', () => {
    const briefless = convo({ id: 'b1', parentId: 'parent' });
    expect(widenedChatContext(briefless, lookup([parent, briefless]))).toBeNull();
  });

  it('returns null for a parentless brief-holder', () => {
    const orphan = convo({ id: 'b1', brief: briefFor('b1') });
    expect(widenedChatContext(orphan, lookup([orphan]))).toBeNull();
  });

  it('returns null when the parent has no messages', () => {
    const empty = convo({ id: 'empty' });
    const branch = convo({ id: 'b1', parentId: 'empty', brief: briefFor('b1') });
    expect(widenedChatContext(branch, lookup([empty, branch]))).toBeNull();
  });

  it('appends the anchor-scoped parent turns and prices them as addedTokens', () => {
    const branch = convo({
      id: 'b1',
      parentId: 'parent',
      brief: briefFor('b1', 'p2'),
      messages: [msg('b1m1', 'user', 'When do applications close?')],
    });
    const widened = widenedChatContext(branch, lookup([parent, branch]));
    expect(widened).not.toBeNull();
    expect(widened?.context).toBe(
      `${renderChatContext(branch).context}\n\n## Pulled from the parent thread (brief was insufficient)\nuser: Which clubs should I join this fall?\n\nassistant: Free Ventures, ML@B, and Blueprint are worth weighing.`,
    );
    expect(widened?.context).not.toContain('Berkeley Consulting');
    expect(widened?.addedTokens).toBe(messagesTokens(parentMessages.slice(0, 2)));
  });

  it('caps the pulled window at the last 12 in-scope parent turns', () => {
    const longParentMessages = Array.from({ length: 14 }, (_, i) =>
      msg(`p${i + 1}`, i % 2 ? 'assistant' : 'user', `Turn ${i + 1} of the parent conversation.`),
    );
    const longParent = convo({ id: 'parent', messages: longParentMessages });
    const branch = convo({
      id: 'b1',
      parentId: 'parent',
      brief: briefFor('b1'),
      messages: [msg('b1m1', 'user', 'When do applications close?')],
    });
    const widened = widenedChatContext(branch, lookup([longParent, branch]));
    expect(widened?.context).not.toContain('Turn 2 of the parent conversation.');
    expect(widened?.context).toContain('Turn 3 of the parent conversation.');
    expect(widened?.context).toContain('Turn 14 of the parent conversation.');
    expect(widened?.addedTokens).toBe(messagesTokens(longParentMessages.slice(-12)));
  });
});
