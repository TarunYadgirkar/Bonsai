import type { Tier } from './types';

/**
 * Single source of truth for tier -> model class. Surfaced on the routing chips.
 *
 * These name a capability class, not a specific model, and that is deliberate: Cortex is
 * unavailable for this build (see AGENTS.md), so no request is sent anywhere and a concrete
 * vendor model name on screen would assert something untrue. Restore real model identifiers
 * here — and only here — if a live inference backend ever lands.
 */
export const MODEL_TIERS: Record<Tier, string> = {
  quick: 'small-fast',
  thoughtful: 'mid-balanced',
  deep: 'large-reasoning',
};

/** USD per 1M tokens, at published rates for each class. Modeled, not billed. */
export const MODEL_PRICING: Record<Tier, { input: number; output: number }> = {
  quick: { input: 0.8, output: 4 },
  thoughtful: { input: 3, output: 15 },
  deep: { input: 15, output: 75 },
};

/** Every internal call (classifier, compiler, merge-distiller) runs here. Cost discipline is the demo. */
export const INTERNAL_TIER: Tier = 'quick';

export function estimateCostUsd(
  tier: Tier,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = MODEL_PRICING[tier];
  const usd = (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

export const TIER_EFFORT: Record<Tier, string> = {
  quick: 'low effort, single pass',
  thoughtful: 'normal effort, one self-check',
  deep: 'high effort, multi-step reasoning',
};

export const TIER_LABEL: Record<Tier, string> = {
  quick: '⚡ Quick',
  thoughtful: '🧠 Thoughtful',
  deep: '🔬 Deep',
};
