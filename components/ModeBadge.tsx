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

/** Cheap → costly, so the tree reads as a spend gradient at a glance. */
export const EFFORT_ACCENT: Record<
  Effort,
  { border: string; bg: string; text: string; kicker: string; stroke: string }
> = {
  low: {
    border: 'border-emerald-400/30',
    bg: 'bg-emerald-400/10',
    text: 'text-emerald-200',
    kicker: 'text-emerald-300',
    stroke: 'rgba(110,231,183,.5)',
  },
  medium: {
    border: 'border-sky-400/30',
    bg: 'bg-sky-400/10',
    text: 'text-sky-200',
    kicker: 'text-sky-300',
    stroke: 'rgba(125,211,252,.5)',
  },
  high: {
    border: 'border-violet-400/30',
    bg: 'bg-violet-400/10',
    text: 'text-violet-200',
    kicker: 'text-violet-300',
    stroke: 'rgba(167,139,250,.5)',
  },
  max: {
    border: 'border-fuchsia-400/30',
    bg: 'bg-fuchsia-400/10',
    text: 'text-fuchsia-200',
    kicker: 'text-fuchsia-300',
    stroke: 'rgba(240,171,252,.55)',
  },
};

export const NEUTRAL_ACCENT = {
  border: 'border-white/10',
  bg: 'bg-white/[0.03]',
  text: 'text-neutral-300',
  kicker: 'text-neutral-400',
  stroke: 'rgba(255,255,255,.18)',
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
  const accent = accentOf(effort);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${accent.border} ${accent.bg} ${accent.text} ${
        size === 'sm' ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs'
      }`}
    >
      {modelLabel}
      {effort && (
        <span className="opacity-70">· {EFFORT_LABEL[effort]}</span>
      )}
    </span>
  );
}
