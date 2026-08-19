import { describe, expect, it } from 'vitest';
import { searchGarden } from '../lib/search';
import type { Conversation } from '../lib/types';

function conv(partial: Partial<Conversation> & { id: string; title: string }): Conversation {
  return {
    parentId: null,
    messages: [],
    insights: [],
    pinnedTier: null,
    archived: false,
    ...partial,
  } as Conversation;
}

const garden: Conversation[] = [
  conv({
    id: 'root',
    title: 'Club decision',
    messages: [
      { id: 'm1', role: 'user', content: 'Which clubs should I consider this semester?' },
      { id: 'm2', role: 'assistant', content: 'Free Ventures, ML@B, and Blueprint.' },
    ],
    insights: [
      { id: 'i1', branchId: 'b1', parentId: 'root', text: 'Free Ventures closes September 11.', createdAt: '2026-08-18T00:00:00Z' },
    ],
  }),
  conv({ id: 'b1', title: 'Free Ventures deadline', parentId: 'root', archived: true }),
];

describe('searchGarden', () => {
  it('ranks title hits above insight hits above message hits', () => {
    const hits = searchGarden(garden, 'free ventures');
    expect(hits.length).toBeGreaterThanOrEqual(3);
    const kindsInOrder = hits.map((h) => `${h.branchId}:${h.kind}`);
    // Archived title hit (weight 3 × 0.5) still beats the live message hit (weight 1).
    expect(kindsInOrder[0]).toBe('root:insight');
    expect(hits.find((h) => h.kind === 'title')?.branchId).toBe('b1');
  });

  it('requires every term to match (AND) and is case-insensitive', () => {
    expect(searchGarden(garden, 'CLUBS semester')).toHaveLength(1);
    expect(searchGarden(garden, 'clubs zeppelin')).toHaveLength(0);
  });

  it('returns nothing for an empty query and builds ellipsed snippets', () => {
    expect(searchGarden(garden, '   ')).toHaveLength(0);
    const [hit] = searchGarden(garden, 'september');
    expect(hit.snippet).toContain('September 11');
  });
});
