import { describe, expect, it } from 'vitest';
import { messagesTokens } from '../src/tokens';
import { availableTokensFor, buildTree, depthOf, lastTier } from '../src/tree';
import type { Conversation, Message, RoutingDecision, Tier } from '../src/types';

function routingFor(tier: Tier): RoutingDecision {
  return {
    tier,
    model: 'claude-haiku-4-5',
    effortNote: 'test',
    contextTokens: 0,
    estCostUsd: 0,
    reason: 'test',
    complexity: 1,
    escalated: false,
    overridden: false,
  };
}

function msg(id: string, role: 'user' | 'assistant', content: string, tier?: Tier): Message {
  return { id, role, content, ...(tier ? { routing: routingFor(tier) } : {}) };
}

const root: Conversation = {
  id: 'root',
  title: 'Club decision',
  parentId: null,
  profile: {
    name: 'Tarun',
    context: 'Berkeley freshman building Bonsai.',
    goals: ['ship the engine', 'join two clubs'],
  },
  messages: [
    msg('r1', 'user', 'Which clubs should I actually consider this semester?'),
    msg('r2', 'assistant', 'Free Ventures, ML@B, and Blueprint are the three worth weighing.'),
  ],
  insights: [],
  pinnedTier: null,
  archived: false,
};

const branch: Conversation = {
  id: 'b1',
  title: 'Free Ventures',
  parentId: 'root',
  messages: [
    msg('m1', 'user', 'When do applications close?'),
    msg('m2', 'assistant', 'Applications close September 11.', 'quick'),
    msg('m3', 'user', 'Rank the clubs by opportunity cost.'),
    msg('m4', 'assistant', 'Ranked: Free Ventures first.', 'deep'),
    msg('m5', 'user', 'Thanks.'),
  ],
  brief: {
    id: 'brief-b1',
    branchId: 'b1',
    selection: 'Free Ventures',
    markdown: '# Branch brief — Free Ventures',
    facts: ['Free Ventures applications close September 11.'],
    excludedNote: 'Excluded: everything else.',
    availableTokens: 5200,
    briefTokens: 180,
    prunedPct: 96.5,
  },
  insights: [],
  pinnedTier: 'deep',
  archived: false,
};

const sub: Conversation = {
  id: 'b2',
  title: 'Info session',
  parentId: 'b1',
  messages: [msg('s1', 'user', 'What happens at the info session?')],
  insights: [],
  pinnedTier: null,
  archived: true,
};

const all = [root, branch, sub];
const byId = (id: string): Conversation | undefined => all.find((c) => c.id === id);

describe('buildTree', () => {
  const nodes = new Map(buildTree(all).map((n) => [n.id, n]));

  it('projects the root with null edge economics', () => {
    const node = nodes.get('root');
    expect(node).toBeDefined();
    expect(node?.parentId).toBeNull();
    expect(node?.childIds).toEqual(['b1']);
    expect(node?.depth).toBe(0);
    expect(node?.messageCount).toBe(2);
    expect(node?.availableTokens).toBeNull();
    expect(node?.inheritedTokens).toBeNull();
    expect(node?.prunedPct).toBeNull();
    expect(node?.lastTier).toBeNull();
    expect(node?.archived).toBe(false);
  });

  it('projects a briefed branch with its brief economics', () => {
    const node = nodes.get('b1');
    expect(node?.parentId).toBe('root');
    expect(node?.childIds).toEqual(['b2']);
    expect(node?.depth).toBe(1);
    expect(node?.messageCount).toBe(5);
    expect(node?.pinnedTier).toBe('deep');
    expect(node?.availableTokens).toBe(5200);
    expect(node?.inheritedTokens).toBe(180);
    expect(node?.prunedPct).toBe(96.5);
  });

  it('reads lastTier off the most recent routed message, skipping trailing unrouted ones', () => {
    expect(nodes.get('b1')?.lastTier).toBe('deep');
  });

  it('projects an archived leaf with no brief and no routing', () => {
    const node = nodes.get('b2');
    expect(node?.childIds).toEqual([]);
    expect(node?.depth).toBe(2);
    expect(node?.archived).toBe(true);
    expect(node?.availableTokens).toBeNull();
    expect(node?.inheritedTokens).toBeNull();
    expect(node?.prunedPct).toBeNull();
    expect(node?.lastTier).toBeNull();
  });
});

describe('lastTier', () => {
  it('is null with no routed messages', () => {
    expect(lastTier(root)).toBeNull();
    expect(lastTier(sub)).toBeNull();
  });

  it('scans backwards to the last routing decision', () => {
    expect(lastTier(branch)).toBe('deep');
  });
});

describe('depthOf', () => {
  it('counts resolvable ancestors', () => {
    expect(depthOf(root, byId)).toBe(0);
    expect(depthOf(branch, byId)).toBe(1);
    expect(depthOf(sub, byId)).toBe(2);
  });

  it('stops at a missing parent', () => {
    const orphan: Conversation = { ...sub, id: 'orphan', parentId: 'missing' };
    expect(depthOf(orphan, byId)).toBe(0);
  });
});

describe('availableTokensFor', () => {
  const profileContent = [
    'Tarun',
    'Berkeley freshman building Bonsai.',
    'ship the engine',
    'join two clubs',
  ].join(' ');
  const rootTokens =
    messagesTokens(root.messages) +
    messagesTokens([{ id: 'profile', role: 'user', content: profileContent }]);

  it('returns 0 for no parent or an unknown parent', () => {
    expect(availableTokensFor(null, byId)).toBe(0);
    expect(availableTokensFor('ghost', byId)).toBe(0);
  });

  it('includes the parent profile as a synthetic message', () => {
    expect(availableTokensFor('root', byId)).toBe(rootTokens);
  });

  it('recurses through ancestors', () => {
    expect(availableTokensFor('b1', byId)).toBe(messagesTokens(branch.messages) + rootTokens);
  });
});
