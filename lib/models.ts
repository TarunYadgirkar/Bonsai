import type { Tier } from './types';

/**
 * Single source of truth for tier -> Snowflake Cortex model, per docs/snowflake-notes.md.
 *
 * PLACEHOLDERS. Model availability varies by Cortex account and region — confirm the exact
 * names against the AI_COMPLETE docs page and the trial account before M1 lands, and change
 * them here only. Nothing else in the codebase should name a model.
 */
export const MODEL_TIERS: Record<Tier, string> = {
  quick: 'claude-haiku',
  thoughtful: 'claude-sonnet',
  deep: 'claude-opus',
};

/** USD per 1M tokens. Placeholders — replace with the account's real Cortex rates. */
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
