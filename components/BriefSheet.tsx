'use client';

import { useEffect, useState } from 'react';
import { Anchor, Sparkle } from '@phosphor-icons/react';
import type { BranchPreviewResponse, ContextBrief } from '@/lib/types';
import { CutStrip, plainFact } from './CutStrip';

/**
 * The brief made visible: before a fork ships, the compiled facts render as chips the user can
 * prune, the anchor stays pinned, and the receipt updates live. The moat, on screen, editable.
 */
export function BriefSheet({
  parentId,
  selection,
  onGrow,
  onClose,
  growing,
  defaultQuestion,
}: {
  parentId: string;
  selection: string;
  /** Prefill for the first-question box (the guided tour seeds one so the merge has material). */
  defaultQuestion?: string;
  /** Ship the fork with the kept facts (in order) and the optional first question. */
  onGrow: (facts: string[], question: string) => void;
  onClose: () => void;
  growing: boolean;
}) {
  const [preview, setPreview] = useState<BranchPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [question, setQuestion] = useState(defaultQuestion ?? '');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/branch/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, selection }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || `POST /api/branch/preview → ${res.status}`);
        }
        return res.json() as Promise<BranchPreviewResponse>;
      })
      .then((data) => !cancelled && setPreview(data))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [parentId, selection]);

  const brief: ContextBrief | null = preview?.brief ?? null;
  const anchorFact = preview?.anchorFact ?? null;
  const kept = brief ? brief.facts.filter((_, i) => !removed.has(i)) : [];
  // Client-side approximation of the receipt (chars/4, same basis the engine estimates with);
  // the server recomputes exactly on grow.
  const keptTokens = brief
    ? Math.ceil((kept.join(' ').length + selection.length + question.length + 60) / 4)
    : 0;
  const avoided = brief ? Math.max(0, brief.availableTokens - keptTokens) : 0;

  const toggle = (i: number) => {
    if (brief && anchorFact && brief.facts[i] === anchorFact) return; // the anchor stays
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-3 sm:items-center sm:p-6"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label="Compiled brief preview"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-surface-raised shadow-lift"
      >
        <header className="px-5 pb-3 pt-4 shadow-[inset_0_-1px_0_var(--rule)]">
          <h2 className="font-display text-lg font-semibold text-ink">Check the brief before it ships</h2>
          <p className="mt-1 line-clamp-2 text-sm text-ink-muted">Branching from “{selection}”</p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="text-sm text-danger">{error}</p>}
          {!brief && !error && (
            <p className="text-sm text-ink-muted" role="status">
              Compiling the brief…
            </p>
          )}
          {brief && (
            <>
              <p className="mb-2 text-xs text-ink-faint">Click a fact to leave it out.</p>
              <div className="flex flex-col gap-1.5">
                {brief.facts.map((fact, i) => {
                  const isAnchor = anchorFact !== null && fact === anchorFact;
                  const isRemoved = removed.has(i);
                  return (
                    <button
                      key={i}
                      onClick={() => toggle(i)}
                      title={
                        isAnchor
                          ? 'The anchor fact: the name this chain of branches depends on. It stays.'
                          : isRemoved
                            ? 'Left out. Click to restore'
                            : 'Click to drop from the brief'
                      }
                      aria-pressed={!isRemoved}
                      className={`rounded-[var(--radius-control)] px-3 py-2 text-left text-[13px] leading-relaxed transition-colors ${
                        isAnchor
                          ? 'bg-accent-wash text-ink'
                          : isRemoved
                            ? 'bg-transparent text-ink-faint line-through ring-1 ring-rule'
                            : 'bg-surface text-ink hover:bg-surface-sunk'
                      }`}
                    >
                      {isAnchor && (
                        <span className="mr-1.5 inline-flex items-center gap-1 text-xs font-medium text-accent">
                          <Anchor weight="bold" className="h-3.5 w-3.5" aria-hidden />
                          Anchor
                        </span>
                      )}
                      {plainFact(fact)}
                    </button>
                  );
                })}
              </div>
              {brief.recalled && brief.recalled.length > 0 && (
                <div className="mt-4">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-accent">
                    <Sparkle weight="fill" className="h-3.5 w-3.5" aria-hidden />
                    Recalled from other branches
                  </p>
                  <ul className="mt-1.5 flex flex-col gap-1 text-[13px] leading-relaxed text-ink">
                    {brief.recalled.map((r) => (
                      <li key={r.text}>
                        {r.text} <span className="text-ink-faint">({r.source})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-4 text-xs leading-relaxed text-ink-faint">{brief.excludedNote}</p>
              <label htmlFor="branch-question" className="mt-4 block text-xs font-medium text-ink-muted">
                First question for the branch (optional)
              </label>
              <textarea
                id="branch-question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={2}
                placeholder="Leave empty to just open the branch…"
                className="mt-1.5 w-full resize-none rounded-[var(--radius-control)] bg-surface px-3 py-2 text-sm text-ink ring-1 ring-rule-strong placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </>
          )}
        </div>

        <footer className="flex flex-col gap-3 px-5 py-3 shadow-[inset_0_1px_0_var(--rule)]">
          {brief && (
            <div className="flex flex-col gap-1.5">
              <CutStrip available={brief.availableTokens} kept={keptTokens} />
              <p className="text-xs text-ink-muted">
                About <span className="tnum text-ink">{keptTokens.toLocaleString()}</span> tokens
                sent, <span className="tnum">{avoided.toLocaleString()}</span> left on the parent
                {removed.size > 0 &&
                  `. You left out ${removed.size} fact${removed.size === 1 ? '' : 's'}`}
                .
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-[var(--radius-control)] px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-sunk hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={() => brief && onGrow(kept, question.trim())}
              disabled={!brief || growing || kept.length === 0}
              className="rounded-[var(--radius-control)] bg-accent px-4 py-2 text-sm font-semibold text-white shadow-bud transition-colors hover:bg-accent-bright disabled:opacity-40"
            >
              {growing ? 'Growing…' : 'Grow branch'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
