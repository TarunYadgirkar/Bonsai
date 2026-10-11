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
 * The dot carries the season; the label stays in ink, because the summer step fails text contrast.
 */
const SEASON_ACCENT: Record<Effort, string> = {
  low: 'var(--season-young)',
  medium: 'var(--season-summer)',
  high: 'var(--season-ember)',
  max: 'var(--season-ember)',
};

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
      className={`inline-flex items-center gap-1.5 rounded-full bg-surface-sunk font-medium text-ink ${
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs'
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
        <span className="font-normal text-ink-muted">{EFFORT_LABEL[effort]}</span>
      )}
    </span>
  );
}
