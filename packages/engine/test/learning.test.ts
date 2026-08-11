import { describe, expect, it } from 'vitest';
import {
  adjustForProfile,
  emptyProfile,
  normalizeProfile,
  profileSummary,
  recordFeedback,
  type RoutingProfile,
} from '../src/learning';

function withMoves(profile: RoutingProfile, kind: 'override' | 'escalation', tier: 'quick' | 'thoughtful' | 'deep', chosen: 'quick' | 'thoughtful' | 'deep', n: number): RoutingProfile {
  let p = profile;
  for (let i = 0; i < n; i += 1) {
    p = recordFeedback(p, { kind, classifiedTier: tier, chosenTier: chosen });
  }
  return p;
}

describe('recordFeedback', () => {
  it('counts an upward override as an up move', () => {
    const p = recordFeedback(emptyProfile(), {
      kind: 'override',
      classifiedTier: 'quick',
      chosenTier: 'deep',
    });
    expect(p.tiers.quick.up).toBe(1);
    expect(p.tiers.quick.moves).toBe(1);
    expect(p.tiers.quick.down).toBe(0);
  });

  it('counts a downward override as a down move', () => {
    const p = recordFeedback(emptyProfile(), {
      kind: 'override',
      classifiedTier: 'deep',
      chosenTier: 'quick',
    });
    expect(p.tiers.deep.down).toBe(1);
    expect(p.tiers.deep.moves).toBe(1);
  });

  it('a same-tier override is not a directional move', () => {
    const p = recordFeedback(emptyProfile(), {
      kind: 'override',
      classifiedTier: 'thoughtful',
      chosenTier: 'thoughtful',
    });
    expect(p.tiers.thoughtful.moves).toBe(0);
  });

  it('escalation is an implicit up move; merge/abandon are non-directional', () => {
    let p = recordFeedback(emptyProfile(), { kind: 'escalation', classifiedTier: 'quick' });
    expect(p.tiers.quick.up).toBe(1);
    expect(p.tiers.quick.moves).toBe(1);
    p = recordFeedback(p, { kind: 'merge', classifiedTier: 'quick' });
    p = recordFeedback(p, { kind: 'abandon', classifiedTier: 'quick' });
    expect(p.tiers.quick.kept).toBe(1);
    expect(p.tiers.quick.dropped).toBe(1);
    expect(p.tiers.quick.moves).toBe(1);
  });

  it('does not mutate the input profile', () => {
    const base = emptyProfile();
    recordFeedback(base, { kind: 'escalation', classifiedTier: 'quick' });
    expect(base.tiers.quick.moves).toBe(0);
  });
});

describe('adjustForProfile', () => {
  it('leaves the tier unchanged below the evidence threshold', () => {
    const p = withMoves(emptyProfile(), 'override', 'quick', 'deep', 2);
    expect(adjustForProfile('quick', p).learned).toBe(false);
    expect(adjustForProfile('quick', p).tier).toBe('quick');
  });

  it('bumps up once a consistent up pattern clears the threshold', () => {
    const p = withMoves(emptyProfile(), 'override', 'quick', 'deep', 3);
    const adj = adjustForProfile('quick', p);
    expect(adj.learned).toBe(true);
    expect(adj.tier).toBe('thoughtful');
    expect(adj.note).toContain('upgraded');
  });

  it('bumps down on a consistent down pattern', () => {
    const p = withMoves(emptyProfile(), 'override', 'deep', 'quick', 4);
    const adj = adjustForProfile('deep', p);
    expect(adj.learned).toBe(true);
    expect(adj.tier).toBe('thoughtful');
    expect(adj.note).toContain('downgraded');
  });

  it('never pushes past the ends of the ladder', () => {
    const up = withMoves(emptyProfile(), 'override', 'deep', 'deep', 5);
    // deep can't go up: same-tier overrides aren't moves, so nothing to shift.
    expect(adjustForProfile('deep', up).learned).toBe(false);
  });

  it('mixed signals below the agreement fraction do not shift', () => {
    // 2 up + 2 down on thoughtful = 4 moves (past the count gate) but 50% agreement (< 60%).
    let p = withMoves(emptyProfile(), 'override', 'thoughtful', 'deep', 2);
    p = withMoves(p, 'override', 'thoughtful', 'quick', 2);
    expect(p.tiers.thoughtful.moves).toBe(4);
    expect(adjustForProfile('thoughtful', p).learned).toBe(false);
  });

  it('returns unchanged when there is no profile', () => {
    expect(adjustForProfile('quick', undefined)).toEqual({
      tier: 'quick',
      learned: false,
      note: '',
    });
  });
});

describe('normalizeProfile', () => {
  it('fills missing tiers and coerces bad numbers to zero', () => {
    const p = normalizeProfile({ version: 1, tiers: { quick: { up: 3, moves: 3 } } });
    expect(p.tiers.quick.up).toBe(3);
    expect(p.tiers.quick.down).toBe(0);
    expect(p.tiers.thoughtful).toEqual({ up: 0, down: 0, kept: 0, dropped: 0, moves: 0 });
  });

  it('handles garbage input without throwing', () => {
    expect(normalizeProfile(null).tiers.deep.moves).toBe(0);
    expect(normalizeProfile({ tiers: { quick: { up: -5, moves: 'x' } } }).tiers.quick.up).toBe(0);
  });
});

describe('profileSummary', () => {
  it('reports no history for an empty profile', () => {
    expect(profileSummary(emptyProfile())).toContain('No routing history');
    expect(profileSummary(undefined)).toContain('defaults');
  });

  it('summarizes moves and keeps', () => {
    let p = withMoves(emptyProfile(), 'override', 'quick', 'deep', 2);
    p = recordFeedback(p, { kind: 'merge', classifiedTier: 'quick' });
    expect(profileSummary(p)).toContain('quick: 2↑ 0↓, 1 kept');
  });
});
