import type { Effort, Tier } from './types';

/**
 * The catalog behind the mode picker: three Claude models × four effort levels, plus Auto
 * (no explicit choice — the router classifies and picks for you).
 *
 * Nothing here is ever sent anywhere. Cortex is barred on this account (AGENTS.md → CLOSED), so
 * these are display names and published-rate pricing used to model spend. Change them here only;
 * nothing else in the codebase may name a model.
 */
export interface ModelSpec {
  id: string;
  label: string;
  /** Tier this model is the default for, and the one the router maps complexity onto. */
  tier: Tier;
  /** USD per 1M tokens, modeled at published rates. */
  input: number;
  output: number;
  /** One line for the picker's hover card. */
  blurb: string;
}

export const MODELS: ModelSpec[] = [
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    tier: 'quick',
    input: 1,
    output: 5,
    blurb: 'Fastest and cheapest. Fact lookups answerable straight from the brief.',
  },
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    tier: 'thoughtful',
    input: 3,
    output: 15,
    blurb: 'Balanced. Synthesis and explanation across a handful of facts.',
  },
  {
    id: 'claude-opus-5',
    label: 'Opus 5',
    tier: 'deep',
    input: 15,
    output: 75,
    blurb: 'Strongest. Multi-constraint reasoning, ranking, weighing trade-offs.',
  },
];

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
  quick: { model: 'claude-haiku-4-5', effort: 'low' },
  thoughtful: { model: 'claude-sonnet-5', effort: 'medium' },
  deep: { model: 'claude-opus-5', effort: 'high' },
};

export const MODEL_TIERS: Record<Tier, string> = {
  quick: TIER_DEFAULTS.quick.model,
  thoughtful: TIER_DEFAULTS.thoughtful.model,
  deep: TIER_DEFAULTS.deep.model,
};

export function modelSpec(id: string): ModelSpec {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export function effortSpec(level: Effort): EffortSpec {
  return EFFORTS.find((e) => e.level === level) ?? EFFORTS[0];
}

/** A manual pick lands on the tier its model is the default for — that drives the ⚡/🧠/🔬 chip. */
export function tierFor(modelId: string): Tier {
  return modelSpec(modelId).tier;
}

/** Every internal call (classifier, compiler, merge-distiller) runs here. Cost discipline is the demo. */
export const INTERNAL_TIER: Tier = 'quick';

export function estimateCostUsd(tier: Tier, inputTokens: number, outputTokens: number): number {
  return costForModel(MODEL_TIERS[tier], inputTokens, outputTokens);
}

export function costForModel(modelId: string, inputTokens: number, outputTokens: number): number {
  const rate = modelSpec(modelId);
  const usd = (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
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

export const TIER_LABEL: Record<Tier, string> = {
  quick: '⚡ Quick',
  thoughtful: '🧠 Thoughtful',
  deep: '🔬 Deep',
};
