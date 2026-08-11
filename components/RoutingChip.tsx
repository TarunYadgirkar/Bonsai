'use client';

import { useEffect, useState } from 'react';
import type { Effort, ModeSelection, RoutingDecision } from '@/lib/types';
import { EFFORT_LABEL, ModeBadge } from './ModeBadge';
import { formatTokens } from './tokens';

interface ModelOption {
  id: string;
  label: string;
  blurb: string;
}

interface Catalog {
  models: ModelOption[];
  efforts: { level: Effort; label: string; note: string }[];
}

/**
 * Fetched once per page, not per chip — the catalog is static config and every assistant
 * message renders one of these. Only a success is cached: a failure clears the promise so
 * the next menu open retries instead of showing "Loading modes…" until a full reload.
 */
let catalogPromise: Promise<Catalog | null> | null = null;

function loadCatalog(): Promise<Catalog | null> {
  catalogPromise ??= fetch('/api/modes')
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((catalog: Catalog | null) => {
      if (!catalog) catalogPromise = null;
      return catalog;
    });
  return catalogPromise;
}

/**
 * The chip is the whole routing story: hover explains the decision, click overrides it —
 * and the override pins the branch, which is the router's teacher.
 */
export function RoutingChip({
  routing,
  mode,
  onSelectMode,
}: {
  routing: RoutingDecision;
  mode: ModeSelection | null;
  onSelectMode: (mode: ModeSelection | null) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  useEffect(() => {
    if (!menuOpen || catalog) return;
    let cancelled = false;
    loadCatalog().then((data) => !cancelled && data && setCatalog(data));
    return () => {
      cancelled = true;
    };
  }, [menuOpen, catalog]);

  const isAuto = !mode || mode.mode === 'auto';
  const label = routing.label ?? routing.modelLabel ?? routing.model;

  return (
    <span className="relative inline-flex">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="group inline-flex cursor-pointer items-center gap-1.5 rounded-full"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Click to override"
      >
        <ModeBadge
          modelLabel={routing.modelLabel ?? routing.model}
          effort={routing.effort}
          size="sm"
        />
        {routing.escalated && (
          <span className="text-[10px] text-amber-300/80">escalated</span>
        )}
        {routing.overridden && (
          <span className="text-[10px] text-neutral-400">pinned</span>
        )}

        {/* Hover card — "Why did Bonsai choose this?" */}
        {!menuOpen && (
          <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-72 flex-col gap-1.5 rounded-lg border border-white/15 bg-neutral-950 p-3 text-left shadow-xl group-hover:flex">
            <span className="flex items-center justify-between">
              <span className="text-xs font-medium text-white">{label}</span>
              <span className="font-mono text-xs tabular-nums text-emerald-300">
                ${routing.estCostUsd.toFixed(4)}
              </span>
            </span>
            <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-neutral-400">
              <span>Context</span>
              <span className="tabular-nums text-neutral-200">
                {formatTokens(routing.contextTokens)} tokens
              </span>
              <span>Effort</span>
              <span className="text-neutral-200">{routing.effortNote}</span>
              <span>Complexity</span>
              <span className="text-neutral-200">{routing.complexity}/3</span>
              {routing.servedBy && (
                <>
                  <span>Served by</span>
                  <span className="truncate font-mono text-neutral-200">{routing.servedBy}</span>
                </>
              )}
            </span>
            <span className="border-t border-white/10 pt-1.5 text-[11px] leading-snug text-neutral-300">
              {routing.reason}
            </span>
            {/* Escalation truth: what the router actually did to the context before answering. */}
            {(routing.coveredByBrief === false || routing.widened) && (
              <span className="flex flex-wrap gap-1">
                {routing.coveredByBrief === false && (
                  <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-200">
                    brief flagged insufficient
                  </span>
                )}
                {routing.widened && (
                  <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] text-sky-200">
                    widened with parent turns
                  </span>
                )}
              </span>
            )}
            <span className="text-[10px] text-neutral-600">Click to override</span>
          </span>
        )}
      </button>

      {menuOpen && (
        <>
          {/* Click-outside catcher */}
          <span
            className="fixed inset-0 z-20"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <span
            role="menu"
            className="absolute bottom-full left-0 z-30 mb-2 flex w-60 flex-col rounded-lg border border-white/15 bg-neutral-950 p-1 shadow-xl"
          >
            <button
              role="menuitem"
              onClick={() => {
                onSelectMode(null);
                setMenuOpen(false);
              }}
              className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-white/10 ${
                isAuto ? 'text-white' : 'text-neutral-300'
              }`}
            >
              Auto
              <span className="text-[10px] text-neutral-500">router decides</span>
              {isAuto && <span className="ml-auto text-[10px]">active</span>}
            </button>

            <span className="mt-1 border-t border-white/10 px-2 pt-1.5 text-[10px] uppercase tracking-wide text-neutral-500">
              Pin this branch
            </span>

            {catalog ? (
              catalog.models.map((model) => (
                <span key={model.id} className="px-1 py-0.5">
                  <span className="px-1 text-[10px] text-neutral-400">{model.label}</span>
                  <span className="mt-0.5 flex gap-1">
                    {catalog.efforts.map((effort) => {
                      const picked =
                        mode?.mode === 'manual' &&
                        mode.model === model.id &&
                        mode.effort === effort.level;
                      return (
                        <button
                          key={effort.level}
                          role="menuitem"
                          title={`${model.label} · ${effort.label} effort — ${effort.note}`}
                          onClick={() => {
                            onSelectMode({
                              mode: 'manual',
                              model: model.id,
                              effort: effort.level,
                            });
                            setMenuOpen(false);
                          }}
                          className={`flex-1 rounded border px-1 py-1 text-[10px] transition-colors ${
                            picked
                              ? 'border-white/40 bg-white/10 text-white'
                              : 'border-white/10 text-neutral-400 hover:bg-white/10 hover:text-neutral-200'
                          }`}
                        >
                          {EFFORT_LABEL[effort.level]}
                        </button>
                      );
                    })}
                  </span>
                </span>
              ))
            ) : (
              <span className="px-2 py-1.5 text-[11px] text-neutral-500">Loading modes…</span>
            )}
          </span>
        </>
      )}
    </span>
  );
}
