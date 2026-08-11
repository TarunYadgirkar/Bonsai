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
          <span className="text-[10px] text-ember">escalated</span>
        )}
        {routing.overridden && (
          <span className="text-[10px] text-bark">pinned</span>
        )}

        {/* Hover card — "Why did Bonsai choose this?" A paper note, not a dark tooltip. */}
        {!menuOpen && (
          <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-72 flex-col gap-1.5 rounded-lg border border-rule bg-paper-raised p-3 text-left shadow-sm group-hover:flex group-focus-within:flex">
            <span className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink">{label}</span>
              <span className="tnum text-xs text-ink">
                ${routing.estCostUsd.toFixed(4)}
              </span>
            </span>
            <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-bark">
              {routing.kind && (
                <>
                  <span>Read as</span>
                  <span className="text-ink-soft">{routing.kind} question</span>
                </>
              )}
              <span>Context</span>
              <span className="text-ink-soft">
                <span className="tnum">{formatTokens(routing.contextTokens)}</span> tokens
              </span>
              <span>Effort</span>
              <span className="text-ink-soft">{routing.effortNote}</span>
              <span>Complexity</span>
              <span className="text-ink-soft">
                <span className="tnum">{routing.complexity}</span>/3
              </span>
              {typeof routing.confidence === 'number' && (
                <>
                  <span>Confidence</span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1 w-16 overflow-hidden rounded-full bg-paper-sunk">
                      <span
                        className="block h-full rounded-full bg-moss"
                        style={{ width: `${Math.round(routing.confidence * 100)}%` }}
                      />
                    </span>
                    <span className="tnum text-ink-soft">{Math.round(routing.confidence * 100)}%</span>
                  </span>
                </>
              )}
              {routing.servedBy && (
                <>
                  <span>Served by</span>
                  <span className="truncate font-mono text-ink-soft">{routing.servedBy}</span>
                </>
              )}
            </span>
            <span className="border-t border-rule pt-1.5 text-[11px] leading-snug text-ink-soft">
              {routing.reason}
            </span>
            {/* Escalation + learning truth: what the router actually did before answering. */}
            {(routing.coveredByBrief === false || routing.widened || routing.learned) && (
              <span className="flex flex-wrap gap-1">
                {routing.learned && (
                  <span className="rounded-full border border-moss/30 bg-moss-wash px-1.5 py-0.5 text-[10px] text-moss">
                    learned from your history
                  </span>
                )}
                {routing.coveredByBrief === false && (
                  <span className="rounded-full border border-rule bg-paper-sunk px-1.5 py-0.5 text-[10px] text-ember">
                    brief flagged insufficient
                  </span>
                )}
                {routing.widened && (
                  <span className="rounded-full border border-moss/30 bg-moss-wash px-1.5 py-0.5 text-[10px] text-moss">
                    widened with parent turns
                  </span>
                )}
              </span>
            )}
            <span className="text-[10px] text-bark">Click to override</span>
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
            className="absolute bottom-full left-0 z-30 mb-2 flex w-60 flex-col rounded-lg border border-rule bg-paper-raised p-1 shadow-sm"
          >
            <button
              role="menuitem"
              onClick={() => {
                onSelectMode(null);
                setMenuOpen(false);
              }}
              className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-paper-sunk ${
                isAuto ? 'text-ink' : 'text-ink-soft'
              }`}
            >
              Auto
              <span className="text-[10px] text-bark">router decides</span>
              {isAuto && <span className="ml-auto text-[10px] text-moss">active</span>}
            </button>

            <span className="mt-1 border-t border-rule px-2 pt-1.5 eyebrow">
              pin this branch
            </span>

            {catalog ? (
              catalog.models.map((model) => (
                <span key={model.id} className="px-1 py-0.5">
                  <span className="px-1 text-[10px] text-bark">{model.label}</span>
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
                              ? 'border-moss bg-moss-wash text-moss'
                              : 'border-rule text-ink-soft hover:bg-paper-sunk hover:text-ink'
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
              <span className="px-2 py-1.5 text-[11px] text-bark">Loading modes…</span>
            )}
          </span>
        </>
      )}
    </span>
  );
}
