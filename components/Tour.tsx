'use client';

/**
 * The 60-second first-session tour: three fixed coach-mark banners that walk a stranger through
 * the whole loop — fork with a compiled brief, merge one insight back, read the receipt — on
 * the demo tree, driving the SAME code paths a real session uses. No fake states: the branch is
 * a real branch, the merge is a real merge, the ledger is the real ledger.
 */
export type TourStep = 'branch' | 'merge' | 'receipt';

const COPY: Record<TourStep, { step: string; text: string; cta: string }> = {
  branch: {
    step: '1 / 3',
    text: 'A branch inherits a compiled brief — a handful of facts instead of the whole 19k-token history.',
    cta: 'Branch a side question for me',
  },
  merge: {
    step: '2 / 3',
    text: 'A branch pays back exactly one distilled insight. Everything else stays pruned.',
    cta: 'Merge the insight back',
  },
  receipt: {
    step: '3 / 3',
    text: 'Every call lands in the ledger — spend, the full-history counterfactual, and what you avoided.',
    cta: 'Open the economics ledger',
  },
};

export function TourBanner({
  step,
  busy,
  onAction,
  onSkip,
}: {
  step: TourStep;
  busy: boolean;
  onAction: () => void;
  onSkip: () => void;
}) {
  const copy = COPY[step];
  return (
    <div className="pointer-events-auto fixed bottom-20 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-xl border border-moss/40 bg-paper-raised p-4 shadow-lg">
      <div className="flex items-baseline gap-2">
        <span className="eyebrow">the 60-second loop · {copy.step}</span>
        <button
          onClick={onSkip}
          className="ml-auto text-[11px] text-bark hover:text-ink-soft"
          aria-label="Skip the tour"
        >
          skip ✕
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{copy.text}</p>
      <button
        onClick={onAction}
        disabled={busy}
        className="mt-2.5 rounded-lg bg-moss px-3.5 py-1.5 text-xs font-medium text-paper transition-colors hover:bg-moss-bright disabled:opacity-40"
      >
        {busy ? 'Working…' : copy.cta}
      </button>
    </div>
  );
}
