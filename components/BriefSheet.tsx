'use client';

import { useEffect, useState } from 'react';
import type { BranchPreviewResponse, ContextBrief } from '@/lib/types';

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
}: {
  parentId: string;
  selection: string;
  /** Ship the fork with the kept facts (in order) and the optional first question. */
  onGrow: (facts: string[], question: string) => void;
  onClose: () => void;
  growing: boolean;
}) {
  const [preview, setPreview] = useState<BranchPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [question, setQuestion] = useState('');

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label="Compiled brief preview"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-rule bg-paper shadow-lg"
      >
        <header className="border-b border-rule bg-paper-raised px-5 py-3">
          <p className="eyebrow">the compiled brief — prune before it ships</p>
          <p className="mt-1 truncate text-sm text-ink">“{selection}”</p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="text-xs text-ember">{error}</p>}
          {!brief && !error && <p className="text-xs text-bark">Compiling the brief…</p>}
          {brief && (
            <>
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
                          ? 'The anchor fact — the referent this chain depends on. It stays.'
                          : isRemoved
                            ? 'Removed — click to restore'
                            : 'Click to drop from the brief'
                      }
                      className={`rounded-lg border px-3 py-1.5 text-left text-xs leading-relaxed transition-colors ${
                        isAnchor
                          ? 'border-moss bg-moss-wash text-ink'
                          : isRemoved
                            ? 'border-rule text-bark line-through opacity-60'
                            : 'border-rule bg-paper-raised text-ink hover:border-rule-strong'
                      }`}
                    >
                      {isAnchor && <span className="mr-1.5 text-[10px] text-moss">⚓ anchor</span>}
                      {fact}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 border-t border-rule pt-2 text-[11px] leading-relaxed text-bark">
                {brief.excludedNote}
              </p>
              <label className="mt-4 block text-[11px] text-ink-soft">
                First question for the branch (optional)
              </label>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={2}
                placeholder="Leave empty to just open the branch…"
                className="mt-1 w-full resize-none rounded-lg border border-rule bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-bark focus:border-moss focus:outline-none"
              />
            </>
          )}
        </div>

        <footer className="flex items-center gap-3 border-t border-rule bg-paper-raised px-5 py-3">
          {brief && (
            <p className="tnum text-[11px] text-bark">
              ~{keptTokens.toLocaleString()} sent ·{' '}
              <span className="text-moss">~{avoided.toLocaleString()} avoided</span>
              {removed.size > 0 && ` · ${removed.size} fact${removed.size === 1 ? '' : 's'} pruned by you`}
            </p>
          )}
          <div className="ml-auto flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-rule-strong px-3 py-1.5 text-xs text-ink-soft transition-colors hover:bg-paper-sunk"
            >
              Cancel
            </button>
            <button
              onClick={() => brief && onGrow(kept, question.trim())}
              disabled={!brief || growing || kept.length === 0}
              className="rounded-lg bg-moss px-4 py-1.5 text-xs font-medium text-paper transition-colors hover:bg-moss-bright disabled:opacity-40"
            >
              {growing ? 'Growing…' : 'Grow branch'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
