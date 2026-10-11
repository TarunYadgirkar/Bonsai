/**
 * The cut: a branch's brief drawn at true scale against the parent context it could have
 * carried. The solid segment is what was sent, the hatched remainder is what was pruned. A 2%
 * brief really is a sliver, which is the whole argument for compiled briefs.
 */

/** A kept segment narrower than this would vanish; it still has to read as "something". */
const MIN_KEPT_PCT = 1.2;

export function keptShare(available: number, kept: number): number {
  if (available <= 0) return 100;
  return Math.min(100, Math.max(MIN_KEPT_PCT, (kept / available) * 100));
}

export function CutStrip({
  available,
  kept,
  size = 'sm',
}: {
  available: number;
  kept: number;
  size?: 'sm' | 'lg';
}) {
  const share = keptShare(available, kept);
  return (
    <span
      role="img"
      aria-label={`${kept.toLocaleString()} of ${available.toLocaleString()} tokens sent`}
      className={`flex w-full overflow-hidden ${size === 'lg' ? 'h-3 rounded-[3px]' : 'h-1.5 rounded-[2px]'}`}
    >
      <span className="h-full shrink-0 bg-[color:var(--kept)]" style={{ width: `${share}%` }} />
      <span className="cut-pruned h-full flex-1" />
    </span>
  );
}

/** Compiled facts can carry the transcript's bold markers; they render as plain text. */
export const plainFact = (fact: string): string => fact.replace(/\*\*/g, '');
