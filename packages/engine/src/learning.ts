/**
 * The router that learns. A static classifier routes every question the same way; this layer
 * personalizes it from what the user actually did — the differentiator in the pitch ("overriding
 * teaches it what you expect next time", "two people type the identical prompt and get different
 * strategies because their histories differ").
 *
 * v2 learns PER QUESTION KIND, not just per tier. "This user's rewrites succeed on cheap models;
 * when they say 'analyze' they expect depth" is a per-kind pattern — so priors are keyed by the
 * classifier's `kind` (lookup / synthesis / comparison / …) with the classified tier, and fall
 * back to a tier-only aggregate until a kind has enough evidence of its own. A v1 profile
 * (tier-only) upgrades in place.
 *
 * Signals, all already logged, all real behavior (not an AI judge):
 *   - override   — the user manually moved the pick up or down: the classifier was wrong for them.
 *   - escalation — the cheap answer failed the sanity check and the ladder upgraded: too low.
 *   - merge      — the branch's answer was kept: the tier that produced it was sufficient.
 *   - abandon    — the branch was discarded: a weak, noisy signal, tracked for confidence only.
 *
 * Every adjustment is explainable in one sentence, which is what makes automation trustable, and
 * a low-confidence classification is deliberately NOT pushed around aggressively.
 */
import type { QuestionKind, Tier } from './types';

export type { QuestionKind };

export const QUESTION_KINDS: QuestionKind[] = [
  'lookup',
  'synthesis',
  'comparison',
  'reasoning',
  'code',
  'creative',
  'other',
];

export type FeedbackKind = 'override' | 'escalation' | 'merge' | 'abandon';

export interface RoutingFeedback {
  kind: FeedbackKind;
  /** The tier the classifier chose (before any adjustment). */
  classifiedTier: Tier;
  /** The tier actually used after an override — required for 'override'. */
  chosenTier?: Tier;
  /** The semantic class of the question, so the correction is attributed to the right kind. */
  questionKind?: QuestionKind;
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

type TierStats = Record<Tier, TierStat>;

export interface RoutingProfile {
  version: 2;
  /** Tier-only aggregate across all kinds — the fallback and the migration target from v1. */
  tiers: TierStats;
  /** Per-question-kind tier stats. Sparse: a kind only appears once it has feedback. */
  kinds: Partial<Record<QuestionKind, TierStats>>;
}

const TIER_ORDER: Tier[] = ['quick', 'thoughtful', 'deep'];

/** Evidence needed before the router will pre-empt the classifier for a user. */
const MIN_MOVES = 3;
/** Base fraction of directional samples that must agree before a shift fires. */
const SHIFT_THRESHOLD = 0.6;
/** Below this classifier confidence, never DOWN-shift — don't risk under-serving an unsure call. */
const DOWNSHIFT_CONFIDENCE_FLOOR = 0.5;

function emptyStat(): TierStat {
  return { up: 0, down: 0, kept: 0, dropped: 0, moves: 0 };
}

function emptyTierStats(): TierStats {
  return { quick: emptyStat(), thoughtful: emptyStat(), deep: emptyStat() };
}

export function emptyProfile(): RoutingProfile {
  return { version: 2, tiers: emptyTierStats(), kinds: {} };
}

function numeric(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function normalizeStat(raw: unknown): TierStat {
  const s = (raw ?? {}) as Partial<TierStat>;
  return {
    up: numeric(s.up),
    down: numeric(s.down),
    kept: numeric(s.kept),
    dropped: numeric(s.dropped),
    moves: numeric(s.moves),
  };
}

function normalizeTierStats(raw: unknown): TierStats {
  const t = (raw ?? {}) as Partial<TierStats>;
  return { quick: normalizeStat(t.quick), thoughtful: normalizeStat(t.thoughtful), deep: normalizeStat(t.deep) };
}

/** Tolerant of partial/legacy JSON — a v1 (tier-only) profile migrates, garbage becomes empty. */
export function normalizeProfile(raw: unknown): RoutingProfile {
  const p = (raw as Partial<RoutingProfile> | undefined) ?? {};
  const profile: RoutingProfile = {
    version: 2,
    tiers: normalizeTierStats(p.tiers),
    kinds: {},
  };
  const kinds = p.kinds ?? {};
  for (const kind of QUESTION_KINDS) {
    const k = (kinds as Record<string, unknown>)[kind];
    if (k) profile.kinds[kind] = normalizeTierStats(k);
  }
  return profile;
}

function step(tier: Tier, delta: number): Tier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(0, Math.min(TIER_ORDER.length - 1, i + delta))];
}

function applyEvent(stat: TierStat, event: RoutingFeedback): void {
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
}

/** Immutable update — folds the feedback into both the per-kind and the aggregate tier stats. */
export function recordFeedback(profile: RoutingProfile, event: RoutingFeedback): RoutingProfile {
  const base = normalizeProfile(profile);
  const tiers = { ...base.tiers, [event.classifiedTier]: { ...base.tiers[event.classifiedTier] } };
  applyEvent(tiers[event.classifiedTier], event);

  const kinds = { ...base.kinds };
  if (event.questionKind) {
    const existing = kinds[event.questionKind] ?? emptyTierStats();
    const updated = { ...existing, [event.classifiedTier]: { ...existing[event.classifiedTier] } };
    applyEvent(updated[event.classifiedTier], event);
    kinds[event.questionKind] = updated;
  }

  return { version: 2, tiers, kinds };
}

export interface LearnedAdjustment {
  tier: Tier;
  /** True when the profile moved the tier off the classifier's choice. */
  learned: boolean;
  /** Whether the shift came from this question's own kind or the tier-only aggregate. */
  source: 'kind' | 'aggregate' | 'none';
  /** One sentence for the "why did Bonsai choose this?" card. Empty when nothing was learned. */
  note: string;
}

export interface AdjustOptions {
  /** The classifier's semantic class for this question. Enables per-kind priors. */
  questionKind?: QuestionKind;
  /** Classifier confidence 0..1. Low confidence tightens the shift and blocks down-shifts. */
  confidence?: number;
  /**
   * Community cold-start. A profile aggregated across users (see mergeProfiles) that a new user
   * inherits until they have their own evidence — so routing is calibrated from day one and
   * improves for everyone as more people use it. This is the network effect: more users → a
   * better population prior → a better cold-start for the next user. The user's own history
   * always wins once it clears the evidence bar.
   */
  population?: RoutingProfile;
}

/**
 * Aggregate many users' profiles into one population prior by summing their stats. The result is
 * the community's collective routing memory — the cold-start every new user starts from.
 * (Aggregate anonymized profiles server-side; this is the pure fold.)
 */
export function mergeProfiles(profiles: RoutingProfile[]): RoutingProfile {
  const out = emptyProfile();
  const addInto = (dst: TierStat, src: TierStat) => {
    dst.up += src.up;
    dst.down += src.down;
    dst.kept += src.kept;
    dst.dropped += src.dropped;
    dst.moves += src.moves;
  };
  for (const raw of profiles) {
    const p = normalizeProfile(raw);
    for (const tier of TIER_ORDER) addInto(out.tiers[tier], p.tiers[tier]);
    for (const kind of QUESTION_KINDS) {
      const ks = p.kinds[kind];
      if (!ks) continue;
      const dst = out.kinds[kind] ?? emptyTierStats();
      for (const tier of TIER_ORDER) addInto(dst[tier], ks[tier]);
      out.kinds[kind] = dst;
    }
  }
  return out;
}

/**
 * Apply the user's learned priors to a freshly classified tier. Prefers evidence from this
 * question's own kind; falls back to the tier-only aggregate; leaves the tier untouched until the
 * evidence is both sufficient and consistent. Low classifier confidence raises the bar and
 * forbids down-shifting, so an unsure call is never quietly under-served.
 */
export function adjustForProfile(
  classifiedTier: Tier,
  profile: RoutingProfile | undefined,
  opts: AdjustOptions = {},
): LearnedAdjustment {
  const confidence = clampConfidence(opts.confidence);

  // Evidence chain: the user's own history first (per-kind, then their tier aggregate), then the
  // community cold-start (its per-kind, then its aggregate). The user always overrides the crowd
  // once their own evidence clears the bar.
  const pick = pickStat(profile, classifiedTier, opts.questionKind, opts.population);
  if (!pick) return { tier: classifiedTier, learned: false, source: 'none', note: '' };
  const { stat, source, community } = pick;

  // A shakier classification demands stronger agreement before we pre-empt it.
  const threshold = Math.min(0.95, SHIFT_THRESHOLD + (1 - confidence) * 0.2);
  const upRate = stat.up / stat.moves;
  const downRate = stat.down / stat.moves;
  const who = community ? 'The community has' : "You've";
  const where = source === 'kind' ? `${opts.questionKind} ` : '';

  if (upRate >= threshold && classifiedTier !== 'deep') {
    const tier = step(classifiedTier, 1);
    return {
      tier,
      learned: true,
      source,
      note: `${who} upgraded ${where}${classifiedTier} picks ${stat.up}/${stat.moves} times, so this one starts at ${tier}.`,
    };
  }
  // Down-shifts are the risky direction: only on a confident classification.
  if (downRate >= threshold && classifiedTier !== 'quick' && confidence >= DOWNSHIFT_CONFIDENCE_FLOOR) {
    const tier = step(classifiedTier, -1);
    return {
      tier,
      learned: true,
      source,
      note: `${who} downgraded ${where}${classifiedTier} picks ${stat.down}/${stat.moves} times, so this one starts at ${tier}.`,
    };
  }
  return { tier: classifiedTier, learned: false, source: 'none', note: '' };
}

/**
 * Walk the evidence chain and return the first tier-stat with enough of its own moves to act on:
 * the user's per-kind history → the user's tier aggregate → the community's per-kind → the
 * community's aggregate. `community` marks that the crowd, not the user, is speaking.
 */
function pickStat(
  profile: RoutingProfile | undefined,
  tier: Tier,
  kind: QuestionKind | undefined,
  population: RoutingProfile | undefined,
): { stat: TierStat; source: 'kind' | 'aggregate'; community: boolean } | null {
  const sources: { profile: RoutingProfile | undefined; community: boolean }[] = [
    { profile, community: false },
    { profile: population, community: true },
  ];
  for (const { profile: prof, community } of sources) {
    if (!prof) continue;
    const p = normalizeProfile(prof);
    const kindStat = kind ? p.kinds[kind]?.[tier] : undefined;
    if (kindStat && kindStat.moves >= MIN_MOVES) return { stat: kindStat, source: 'kind', community };
    const agg = p.tiers[tier];
    if (agg.moves >= MIN_MOVES) return { stat: agg, source: 'aggregate', community };
  }
  return null;
}

function clampConfidence(c: number | undefined): number {
  if (typeof c !== 'number' || !Number.isFinite(c)) return 1; // absent → trust the classifier
  return Math.max(0, Math.min(1, c));
}

/** Compact human summary for a settings/economics view. */
export function profileSummary(profile: RoutingProfile | undefined): string {
  if (!profile) return 'No routing history yet — the router is using defaults.';
  const p = normalizeProfile(profile);
  const parts: string[] = [];
  for (const tier of TIER_ORDER) {
    const s = p.tiers[tier];
    if (s.moves > 0 || s.kept > 0) parts.push(`${tier}: ${s.up}↑ ${s.down}↓, ${s.kept} kept`);
  }
  const learnedKinds = QUESTION_KINDS.filter((k) => {
    const ks = p.kinds[k];
    return ks && TIER_ORDER.some((t) => ks[t].moves >= MIN_MOVES);
  });
  if (learnedKinds.length) parts.push(`learned kinds: ${learnedKinds.join(', ')}`);
  return parts.length ? parts.join(' · ') : 'No routing history yet — the router is using defaults.';
}
