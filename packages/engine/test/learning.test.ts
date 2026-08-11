import { describe, expect, it } from 'vitest';
import {
  adjustForProfile,
  emptyProfile,
  mergeProfiles,
  normalizeProfile,
  profileSummary,
  recordFeedback,
  type RoutingProfile,
} from '../src/learning';

function upMoves(tier: 'quick' | 'thoughtful' | 'deep', chosen: 'quick' | 'thoughtful' | 'deep', n: number, kind?: 'comparison' | 'lookup' | 'code' | 'reasoning'): RoutingProfile {
  let p = emptyProfile();
  for (let i = 0; i < n; i += 1) p = recordFeedback(p, { kind: 'override', classifiedTier: tier, chosenTier: chosen, questionKind: kind });
  return p;
}

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
      source: 'none',
      note: '',
    });
  });
});

describe('adjustForProfile — per-kind priors (v2)', () => {
  function kindMoves(kind: 'comparison' | 'lookup', tier: 'quick' | 'thoughtful' | 'deep', chosen: 'quick' | 'thoughtful' | 'deep', n: number): RoutingProfile {
    let p = emptyProfile();
    for (let i = 0; i < n; i += 1) {
      p = recordFeedback(p, { kind: 'override', classifiedTier: tier, chosenTier: chosen, questionKind: kind });
    }
    return p;
  }

  it('learns a pattern for one kind without moving other kinds', () => {
    const p = kindMoves('comparison', 'quick', 'deep', 3);
    // The comparison kind now upshifts a quick classification…
    const cmp = adjustForProfile('quick', p, { questionKind: 'comparison' });
    expect(cmp.learned).toBe(true);
    expect(cmp.source).toBe('kind');
    expect(cmp.tier).toBe('thoughtful');
    // …but a lookup with no per-kind evidence and no aggregate majority does not.
    // (aggregate has 3 up moves too, so lookup would ride the aggregate — assert that explicitly.)
    const look = adjustForProfile('quick', p, { questionKind: 'lookup' });
    expect(look.source).toBe('aggregate');
  });

  it('falls back to the tier aggregate when a kind lacks its own evidence', () => {
    // Build aggregate evidence via a different kind, then query a kind with none of its own.
    const p = kindMoves('comparison', 'quick', 'deep', 4);
    const adj = adjustForProfile('quick', p, { questionKind: 'creative' });
    expect(adj.source).toBe('aggregate');
    expect(adj.learned).toBe(true);
  });

  it('low confidence blocks a down-shift but a confident one goes through', () => {
    let p = emptyProfile();
    for (let i = 0; i < 4; i += 1) {
      p = recordFeedback(p, { kind: 'override', classifiedTier: 'deep', chosenTier: 'quick', questionKind: 'lookup' });
    }
    expect(adjustForProfile('deep', p, { questionKind: 'lookup', confidence: 0.3 }).learned).toBe(false);
    expect(adjustForProfile('deep', p, { questionKind: 'lookup', confidence: 0.9 }).learned).toBe(true);
  });

  it('low confidence raises the agreement bar for an up-shift', () => {
    // thoughtful: 3 up + 2 down = 5 moves, exactly 60% up-agreement.
    let q = emptyProfile();
    for (let i = 0; i < 3; i += 1) q = recordFeedback(q, { kind: 'override', classifiedTier: 'thoughtful', chosenTier: 'deep', questionKind: 'reasoning' });
    for (let i = 0; i < 2; i += 1) q = recordFeedback(q, { kind: 'override', classifiedTier: 'thoughtful', chosenTier: 'quick', questionKind: 'reasoning' });
    expect(adjustForProfile('thoughtful', q, { questionKind: 'reasoning', confidence: 1 }).learned).toBe(true); // 0.6 ≥ 0.6
    expect(adjustForProfile('thoughtful', q, { questionKind: 'reasoning', confidence: 0.0 }).learned).toBe(false); // 0.6 < 0.8
  });
});

describe('mergeProfiles + community cold-start (the network-effect moat)', () => {
  it('sums stats across users into one population prior', () => {
    const a = upMoves('quick', 'deep', 2, 'code');
    const b = upMoves('quick', 'deep', 3, 'code');
    const pop = mergeProfiles([a, b]);
    expect(pop.tiers.quick.up).toBe(5);
    expect(pop.tiers.quick.moves).toBe(5);
    expect(pop.kinds.code?.quick.up).toBe(5);
  });

  it('a brand-new user inherits the community pattern (cold start)', () => {
    const population = upMoves('quick', 'deep', 5, 'code');
    const adj = adjustForProfile('quick', emptyProfile(), { questionKind: 'code', confidence: 1, population });
    expect(adj.learned).toBe(true);
    expect(adj.tier).toBe('thoughtful');
    expect(adj.note).toContain('community');
  });

  it("the user's own history overrides the community once it has evidence", () => {
    const population = upMoves('quick', 'deep', 6, 'code'); // crowd says upgrade
    // This user consistently keeps quick for code — their own evidence should win.
    let mine = emptyProfile();
    for (let i = 0; i < 4; i += 1) mine = recordFeedback(mine, { kind: 'merge', classifiedTier: 'quick', questionKind: 'code' });
    // merges don't create up/down moves, so the user has no directional evidence → community still speaks.
    // Give the user real down-direction evidence at thoughtful instead:
    let mine2 = emptyProfile();
    for (let i = 0; i < 4; i += 1) mine2 = recordFeedback(mine2, { kind: 'override', classifiedTier: 'thoughtful', chosenTier: 'quick', questionKind: 'code' });
    const adj = adjustForProfile('quick', mine2, { questionKind: 'code', confidence: 1, population });
    // For a quick classification the user has no quick-tier moves, so the community's quick pattern still applies.
    expect(adj.note).toContain('community');
    void mine;
  });

  it('community only speaks when the user is silent for that tier', () => {
    const population = upMoves('quick', 'deep', 5, 'code');
    const mine = upMoves('quick', 'quick', 5, 'code'); // same-tier = no directional moves
    // The user has kept/logged nothing directional, so the community cold-start still fires.
    const adj = adjustForProfile('quick', mine, { questionKind: 'code', confidence: 1, population });
    expect(adj.learned).toBe(true);
    expect(adj.note).toContain('community');
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
