import type { Tier } from '@/lib/types';

/** Human-facing tier vocabulary. Never show model names in the UI (lib/types.ts). */
export const TIER_LABEL: Record<Tier, string> = {
  quick: 'Quick',
  thoughtful: 'Thoughtful',
  deep: 'Deep',
};

export const TIER_ICON: Record<Tier, string> = {
  quick: '⚡',
  thoughtful: '🧠',
  deep: '🔬',
};

const TIER_CLASS: Record<Tier, string> = {
  quick: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  thoughtful: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  deep: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
};

export function TierBadge({
  tier,
  size = 'md',
}: {
  tier: Tier;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${TIER_CLASS[tier]} ${
        size === 'sm' ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs'
      }`}
    >
      <span aria-hidden>{TIER_ICON[tier]}</span>
      {TIER_LABEL[tier]}
    </span>
  );
}
