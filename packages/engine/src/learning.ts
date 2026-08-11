/**
 * The router that learns. A static classifier routes every question the same way; this layer
 * personalizes it from what the user actually did — the differentiator in the pitch ("overriding
 * teaches it what you expect next time", "learns from what you kept").
 *
 * Signals, all already logged, all real behavior (not an AI judge):
 *   - override   — the user manually moved the pick up or down: the classifier was wrong for them.
 *   - escalation — the cheap answer failed the sanity check and the ladder upgraded: the starting
 *                  tier was too low. An implicit override-up.
 *   - merge      — the branch's answer was kept: the tier that produced it was sufficient.
 *   - abandon    — the branch was discarded: a weak, noisy signal, tracked for confidence only.
 *
 * The rule is deliberately transparent, not a black box: once there is enough evidence that the
 * user consistently pushes a classified tier in one direction, the router pre-empts it and says
 * why. Every adjustment is explainable in one sentence, which is what makes automation trustable.
 */
import type { Tier } from './types';

export type FeedbackKind = 'override' | 'escalation' | 'merge' | 'abandon';

export interface RoutingFeedback {
  kind: FeedbackKind;
  /** The tier the classifier chose (before any adjustment). */
  classifiedTier: Tier;
  /** The tier actually used after an override — required for 'override'. */
  chosenTier?: Tier;
}

interface TierStat {
  /** Times the user pushed this classified tier to a stronger one (override up or escalation). */
  up: number;
  /** Times the user pushed it to a weaker one. */
  down: number;
  /** Times a branch at this tier was merged back — the pick was good enough. */
  kept: number;
  /** Times a branch at this tier was abandoned. */
  dropped: number;
  /** Directional samples (up + down) — the denominator for a shift decision. */
  moves: number;
}

export interface RoutingProfile {
  version: 1;
  tiers: Record<Tier, TierStat>;
}

const TIER_ORDER: Tier[] = ['quick', 'thoughtful', 'deep'];

/** Evidence needed before the router will pre-empt the classifier for a user. */
const MIN_MOVES = 3;
/** Fraction of directional samples that must agree before a shift fires. */
const SHIFT_THRESHOLD = 0.6;

function emptyStat(): TierStat {
  return { up: 0, down: 0, kept: 0, dropped: 0, moves: 0 };
}

export function emptyProfile(): RoutingProfile {
  return {
    version: 1,
    tiers: { quick: emptyStat(), thoughtful: emptyStat(), deep: emptyStat() },
  };
}

/** Tolerant of partial/legacy JSON — a missing tier becomes an empty stat, never a crash. */
export function normalizeProfile(raw: unknown): RoutingProfile {
  const profile = emptyProfile();
  const tiers = (raw as RoutingProfile | undefined)?.tiers;
  if (!tiers) return profile;
  for (const tier of TIER_ORDER) {
    const s = tiers[tier];
    if (!s) continue;
    profile.tiers[tier] = {
      up: numeric(s.up),
      down: numeric(s.down),
      kept: numeric(s.kept),
      dropped: numeric(s.dropped),
      moves: numeric(s.moves),
    };
  }
  return profile;
}

function numeric(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function step(tier: Tier, delta: number): Tier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(0, Math.min(TIER_ORDER.length - 1, i + delta))];
}

/** Immutable update — returns a new profile with the feedback folded in. */
export function recordFeedback(profile: RoutingProfile, event: RoutingFeedback): RoutingProfile {
  const base = normalizeProfile(profile);
  const stat = { ...base.tiers[event.classifiedTier] };

  switch (event.kind) {
    case 'override': {
      const from = TIER_ORDER.indexOf(event.classifiedTier);
      const to = TIER_ORDER.indexOf(event.chosenTier ?? event.classifiedTier);
      if (to > from) {
        stat.up += 1;
        stat.moves += 1;
      } else if (to < from) {
        stat.down += 1;
        stat.moves += 1;
      }
      break;
    }
    case 'escalation':
      stat.up += 1;
      stat.moves += 1;
      break;
    case 'merge':
      stat.kept += 1;
      break;
    case 'abandon':
      stat.dropped += 1;
      break;
  }

  return {
    ...base,
    tiers: { ...base.tiers, [event.classifiedTier]: stat },
  };
}

export interface LearnedAdjustment {
  tier: Tier;
  /** True when the profile moved the tier off the classifier's choice. */
  learned: boolean;
  /** One sentence for the "why did Bonsai choose this?" card. Empty when nothing was learned. */
  note: string;
}

/**
 * Apply the user's learned priors to a freshly classified tier. Returns the classified tier
 * unchanged (learned: false) until there is enough consistent evidence to justify pre-empting it.
 */
export function adjustForProfile(
  classifiedTier: Tier,
  profile: RoutingProfile | undefined,
): LearnedAdjustment {
  if (!profile) return { tier: classifiedTier, learned: false, note: '' };
  const stat = normalizeProfile(profile).tiers[classifiedTier];
  if (stat.moves < MIN_MOVES) return { tier: classifiedTier, learned: false, note: '' };

  const upRate = stat.up / stat.moves;
  const downRate = stat.down / stat.moves;

  if (upRate >= SHIFT_THRESHOLD && classifiedTier !== 'deep') {
    const tier = step(classifiedTier, 1);
    return {
      tier,
      learned: true,
      note: `You've upgraded ${classifiedTier} picks ${stat.up}/${stat.moves} times, so this one starts at ${tier}.`,
    };
  }
  if (downRate >= SHIFT_THRESHOLD && classifiedTier !== 'quick') {
    const tier = step(classifiedTier, -1);
    return {
      tier,
      learned: true,
      note: `You've downgraded ${classifiedTier} picks ${stat.down}/${stat.moves} times, so this one starts at ${tier}.`,
    };
  }
  return { tier: classifiedTier, learned: false, note: '' };
}

/** Compact human summary for a settings/economics view. */
export function profileSummary(profile: RoutingProfile | undefined): string {
  if (!profile) return 'No routing history yet — the router is using defaults.';
  const p = normalizeProfile(profile);
  const parts = TIER_ORDER.filter((t) => p.tiers[t].moves > 0 || p.tiers[t].kept > 0).map((t) => {
    const s = p.tiers[t];
    return `${t}: ${s.up}↑ ${s.down}↓, ${s.kept} kept`;
  });
  return parts.length ? parts.join(' · ') : 'No routing history yet — the router is using defaults.';
}
