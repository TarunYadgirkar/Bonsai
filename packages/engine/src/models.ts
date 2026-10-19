import type { Effort, Tier } from './types';

// Presentation is model + effort, never a tier name — see routingLabel at the bottom of this file.

/**
 * The catalog behind the mode picker: three Claude models × four effort levels, plus Auto
 * (no explicit choice — the router classifies and picks for you).
 *
 * Each id is the real Anthropic model id (provider.ts calls it as-is) and carries its published
 * rate. Change them here only; nothing else in the codebase may name a model.
 */
export interface ModelSpec {
  id: string;
  label: string;
  /**
   * Tier used for classification and baselines. Opus 5.5 and Fable 5.1 share `deep` because `Tier` is
   * frozen at three values (lib/types.ts) — the ladder above deep is expressed by model, not tier.
   */
  tier: Tier;
  /** USD per 1M tokens, list rate. */
  input: number;
  output: number;
  /**
   * USD per 1M tokens on a prompt-cache hit. This is what a full-history fork actually pays for
   * the parent transcript once the parent has warmed the cache — the honest baseline for a
   * cache-shared native fork, not the list rate.
   */
  cacheRead: number;
  /** One line for the picker's hover card. */
  blurb: string;
}

/**
 * Rates verified against platform.claude.com pricing 2026-10-10. Cache reads are 0.1x list input
 * except on Opus 5.5 ($0.20, 0.05x) and Fable 5.1 ($0.25, 0.025x). Haiku 5.5's rate is the <=100K-token
 * prompt card; briefs never get near that, and the ceiling baseline is priced on Fable anyway.
 */
export const MODELS: ModelSpec[] = [
  {
    id: 'claude-haiku-5-5',
    label: 'Haiku 5.5',
    tier: 'quick',
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    blurb: 'Fastest and cheapest. Fact lookups answerable straight from the brief.',
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Sonnet 5.5',
    tier: 'thoughtful',
    input: 2,
    output: 10,
    cacheRead: 0.2,
    blurb: 'Balanced. Synthesis and explanation across a handful of facts.',
  },
  {
    id: 'claude-opus-5-5',
    label: 'Opus 5.5',
    tier: 'deep',
    input: 4,
    output: 20,
    cacheRead: 0.2,
    blurb: 'Deep reasoning. Multi-constraint ranking and weighing trade-offs.',
  },
  {
    id: 'claude-fable-5-1',
    label: 'Fable 5.1',
    tier: 'deep',
    input: 10,
    output: 50,
    cacheRead: 0.25,
    blurb: 'The ceiling. Where a deep answer goes when it still is not good enough.',
  },
];

/** Top of the ladder: what a failed deep answer escalates onto, and the highest manual pick. */
export const CEILING_MODEL = 'claude-fable-5-1';

/**
 * Catalog ids before the 2026-10 refresh, mapped to their successors. Stored trees, extension
 * pins and plugin pins still carry these; they resolve to the successor rather than silently
 * landing on the first catalog entry. Historical rows keep their own `label`, and anything a
 * legacy model actually served is priced at its own published rate, not the successor's.
 */
export const LEGACY_MODEL_IDS: Record<
  string,
  { successor: string; label: string; input: number; output: number; cacheRead: number }
> = {
  'claude-haiku-4-5': { successor: 'claude-haiku-5-5', label: 'Haiku 4.5', input: 1, output: 5, cacheRead: 0.1 },
  'claude-sonnet-5': { successor: 'claude-sonnet-5-5', label: 'Sonnet 5', input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-5': { successor: 'claude-opus-5-5', label: 'Opus 5', input: 5, output: 25, cacheRead: 0.5 },
  'claude-fable-5': { successor: 'claude-fable-5-1', label: 'Fable 5', input: 10, output: 50, cacheRead: 1 },
};

const legacyEntry = (id: string) =>
  Object.hasOwn(LEGACY_MODEL_IDS, id) ? LEGACY_MODEL_IDS[id] : undefined;

/** Catalog id for any id the app has ever stored: current ids pass through, legacy ids map forward. */
export function canonicalModelId(id: string): string {
  if (MODELS.some((m) => m.id === id)) return id;
  return legacyEntry(id)?.successor ?? id;
}

/** Display label for a stored id, without relabelling history as the successor. */
export function modelLabelFor(id: string): string {
  return MODELS.find((m) => m.id === id)?.label ?? legacyEntry(id)?.label ?? id;
}

/**
 * The published rate of whichever Claude model an id names: current or legacy, bare or
 * date-suffixed (longest prefix wins, so `claude-opus-5-5` never matches `claude-opus-5`).
 */
function claudeRateFor(id: string): { input: number; output: number } | undefined {
  const candidates: [string, { input: number; output: number }][] = [
    ...MODELS.map((m): [string, ModelSpec] => [m.id, m]),
    ...Object.entries(LEGACY_MODEL_IDS),
  ];
  let best: [string, { input: number; output: number }] | undefined;
  for (const candidate of candidates) {
    if (id.startsWith(candidate[0]) && candidate[0].length > (best?.[0].length ?? 0)) best = candidate;
  }
  return best?.[1];
}

export interface EffortSpec {
  level: Effort;
  label: string;
  /** Output-token ceiling. Effort is spend on thinking, and this is how it is priced. */
  maxTokens: number;
  note: string;
}

export const EFFORTS: EffortSpec[] = [
  { level: 'low', label: 'Low', maxTokens: 300, note: 'single pass, no self-check' },
  { level: 'medium', label: 'Medium', maxTokens: 700, note: 'one self-check' },
  { level: 'high', label: 'High', maxTokens: 1500, note: 'multi-step reasoning' },
  { level: 'max', label: 'Max', maxTokens: 3000, note: 'exhaustive, weighs alternatives' },
];

/** What Auto picks when the classifier lands on a tier. */
export const TIER_DEFAULTS: Record<Tier, { model: string; effort: Effort }> = {
  quick: { model: 'claude-haiku-5-5', effort: 'low' },
  thoughtful: { model: 'claude-sonnet-5-5', effort: 'medium' },
  deep: { model: 'claude-opus-5-5', effort: 'high' },
};

export const MODEL_TIERS: Record<Tier, string> = {
  quick: TIER_DEFAULTS.quick.model,
  thoughtful: TIER_DEFAULTS.thoughtful.model,
  deep: TIER_DEFAULTS.deep.model,
};

export function modelSpec(id: string): ModelSpec {
  const canonical = canonicalModelId(id);
  return MODELS.find((m) => m.id === canonical) ?? MODELS[0];
}

export function effortSpec(level: Effort): EffortSpec {
  return EFFORTS.find((e) => e.level === level) ?? EFFORTS[0];
}

/** A manual pick lands on the tier its model is the default for; the tier stays internal. */
export function tierFor(modelId: string): Tier {
  return modelSpec(modelId).tier;
}

/** Every internal call (classifier, compiler, merge-distiller) runs here. Cost discipline is the demo. */
export const INTERNAL_TIER: Tier = 'quick';

export function estimateCostUsd(tier: Tier, inputTokens: number, outputTokens: number): number {
  return costForModel(MODEL_TIERS[tier], inputTokens, outputTokens);
}

export function costForModel(modelId: string, inputTokens: number, outputTokens: number): number {
  const rate = legacyEntry(modelId) ?? modelSpec(modelId);
  const usd = (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/** The whole price catalog (ModelSpec rates + UPSTREAM_RATES) was last verified against
 *  provider pricing pages on this date. Surfaced in the economics UI — stale prices should
 *  look stale, not eternal. */
export const PRICES_AS_OF = '2026-10-10';

/**
 * Rates for non-Anthropic upstreams (provider.ts DEFAULT_UPSTREAM), USD per MTok. OpenAI and
 * xAI verified 2026-08-10 (not re-verified since; Anthropic rates were, 2026-10-10); Gemini
 * verified 2026-10-18. When `servedBy` names one of these, spend must be priced at ITS rate — pricing a
 * gpt answer at Claude rates is fiction.
 */
const UPSTREAM_RATES: Record<string, { input: number; output: number }> = {
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'gpt-5.4': { input: 2.5, output: 15 },
  'gpt-5.5': { input: 5, output: 30 },
  'grok-4.3': { input: 1.25, output: 2.5 },
  'grok-4.5': { input: 2, output: 6 },
  // Gemini paid tier, prompts up to 200K tokens, verified 2026-10-18. Google has announced
  // increases from 2026-12-01 (4 Argon) and 2027-01-01 (most others).
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.1-pro-preview': { input: 2, output: 12 },
  'gemini-4-argon': { input: 2, output: 10 },
};

/**
 * Can the catalog price this upstream truthfully? True for: no servedBy (mock/modeled —
 * estimated at catalog rate, which the measured flag already discloses), a known non-Anthropic
 * upstream, or a versioned variant of a catalog Claude model. An env-overridden upstream the
 * tables have never heard of returns false — its "cost" would be fiction, and fiction must be
 * excluded from savings totals rather than silently summed (the LiteLLM lesson).
 */
export function isPricedServedBy(servedBy: string | undefined): boolean {
  if (!servedBy) return true;
  if (Object.hasOwn(UPSTREAM_RATES, servedBy)) return true;
  return claudeRateFor(servedBy) !== undefined;
}

/** Cost at the rate of whichever model actually answered; Bonsai-catalog rate otherwise. */
export function costForServedBy(
  servedBy: string | undefined,
  bonsaiModelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = !servedBy
    ? undefined
    : Object.hasOwn(UPSTREAM_RATES, servedBy)
      ? UPSTREAM_RATES[servedBy]
      : claudeRateFor(servedBy);
  if (!rate) return costForModel(bonsaiModelId, inputTokens, outputTokens);
  const usd = (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * The counterfactual no vendor will ever show you: this request, carrying full history, on the
 * ceiling model. Computable exactly from token counts with zero extra API calls.
 */
export function ceilingCostUsd(inputTokens: number, outputTokens: number): number {
  return costForModel(CEILING_MODEL, inputTokens, outputTokens);
}

/**
 * The cache-honest counterfactual. A native fork (Claude Code `/fork`, any cache-shared copy)
 * does not re-pay list price for the parent transcript: it reads it from the prompt cache. This
 * prices the ENTIRE baseline input at the model's cache-hit rate — deliberately generous to the
 * baseline (the new question itself is never cached) so the savings it implies are a floor.
 */
export function warmBaselineCostUsd(
  modelId: string,
  baselineInputTokens: number,
  outputTokens: number,
): number {
  const rate = modelSpec(modelId);
  const usd = (baselineInputTokens * rate.cacheRead + outputTokens * rate.output) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

export function warmCeilingCostUsd(baselineInputTokens: number, outputTokens: number): number {
  return warmBaselineCostUsd(CEILING_MODEL, baselineInputTokens, outputTokens);
}

/** Legacy shape kept for callers that price by tier. Derived, so the catalog stays single-source. */
export const MODEL_PRICING: Record<Tier, { input: number; output: number }> = {
  quick: { input: modelSpec(MODEL_TIERS.quick).input, output: modelSpec(MODEL_TIERS.quick).output },
  thoughtful: {
    input: modelSpec(MODEL_TIERS.thoughtful).input,
    output: modelSpec(MODEL_TIERS.thoughtful).output,
  },
  deep: { input: modelSpec(MODEL_TIERS.deep).input, output: modelSpec(MODEL_TIERS.deep).output },
};

export function effortNote(modelId: string, effort: Effort): string {
  return `${modelSpec(modelId).label} · ${effortSpec(effort).label} effort — ${effortSpec(effort).note}`;
}

export const TIER_EFFORT: Record<Tier, string> = {
  quick: effortNote(MODEL_TIERS.quick, 'low'),
  thoughtful: effortNote(MODEL_TIERS.thoughtful, 'medium'),
  deep: effortNote(MODEL_TIERS.deep, 'high'),
};

/**
 * How a routing decision reads on screen: model and effort, the way Claude states it —
 * "Opus 5.5 · High effort". The old ⚡/🧠/🔬 tier names are gone from the surface (Tarun,
 * 2026-08-07); `Tier` survives only as the classifier's internal 1-3 mapping.
 */
export function routingLabel(modelId: string, effort: Effort): string {
  return `${modelSpec(modelId).label} · ${effortSpec(effort).label} effort`;
}

/** What Auto's choice reads as for a given tier, for pickers that still think in tiers. */
export const TIER_LABEL: Record<Tier, string> = {
  quick: routingLabel(TIER_DEFAULTS.quick.model, TIER_DEFAULTS.quick.effort),
  thoughtful: routingLabel(TIER_DEFAULTS.thoughtful.model, TIER_DEFAULTS.thoughtful.effort),
  deep: routingLabel(TIER_DEFAULTS.deep.model, TIER_DEFAULTS.deep.effort),
};
