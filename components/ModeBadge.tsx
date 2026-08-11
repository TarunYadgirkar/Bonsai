import type { Effort } from '@/lib/types';

/**
 * How a routing decision reads on screen: model and effort, the way Claude states it.
 * Replaces the old ⚡/🧠/🔬 tier badge — tier is an engine-internal classification now
 * (AGENTS.md → M5), so it never reaches the surface.
 */
export const EFFORT_LABEL: Record<Effort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
};

/**
 * Effort maps to the horticultural season scale (DESIGN.md), not a cost-purple ramp:
 * young growth → summer → ember, cheap → expensive. high and max both read as ember.
 * Consumed via inline style so the exact paper vars land, not an approximate Tailwind step.
 */
const SEASON_ACCENT: Record<Effort, string> = {
  low: 'var(--season-young)',
  medium: 'var(--season-summer)',
  high: 'var(--season-ember)',
  max: 'var(--season-ember)',
};

/**
 * Season tints for the branch tree surface. Same object shape as before — border/bg/text/kicker
 * are Tailwind classes, stroke is a raw SVG colour — so TreeSidebar keeps consuming it unchanged.
 */
export const EFFORT_ACCENT: Record<
  Effort,
  { border: string; bg: string; text: string; kicker: string; stroke: string }
> = {
  low: {
    border: 'border-[#7fa05b]/35',
    bg: 'bg-[#7fa05b]/10',
    text: 'text-[#7fa05b]',
    kicker: 'text-[#7fa05b]',
    stroke: '#7fa05b',
  },
  medium: {
    border: 'border-[#c8a24a]/35',
    bg: 'bg-[#c8a24a]/10',
    text: 'text-[#c8a24a]',
    kicker: 'text-[#c8a24a]',
    stroke: '#c8a24a',
  },
  high: {
    border: 'border-[#b65a2e]/35',
    bg: 'bg-[#b65a2e]/10',
    text: 'text-[#b65a2e]',
    kicker: 'text-[#b65a2e]',
    stroke: '#b65a2e',
  },
  max: {
    border: 'border-[#b65a2e]/40',
    bg: 'bg-[#b65a2e]/15',
    text: 'text-[#b65a2e]',
    kicker: 'text-[#b65a2e]',
    stroke: '#b65a2e',
  },
};

export const NEUTRAL_ACCENT = {
  border: 'border-rule',
  bg: 'bg-paper-sunk',
  text: 'text-ink-soft',
  kicker: 'text-bark',
  stroke: '#8a7f6a',
};

export const accentOf = (effort: Effort | null | undefined) =>
  effort ? EFFORT_ACCENT[effort] : NEUTRAL_ACCENT;

export function ModeBadge({
  modelLabel,
  effort,
  size = 'md',
}: {
  modelLabel: string;
  effort?: Effort;
  size?: 'sm' | 'md';
}) {
  const seasonColor = effort ? SEASON_ACCENT[effort] : undefined;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-rule bg-paper-raised font-medium text-ink ${
        size === 'sm' ? 'px-2 py-[1px] text-[10px]' : 'px-2.5 py-0.5 text-xs'
      }`}
    >
      {effort && (
        // A season-tinted bud reads the spend tier without a cost-purple ramp.
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: seasonColor }}
        />
      )}
      <span>{modelLabel}</span>
      {effort && (
        <span style={{ color: seasonColor }}>{EFFORT_LABEL[effort]}</span>
      )}
    </span>
  );
}
