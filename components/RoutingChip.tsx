'use client';

import { useState } from 'react';
import type { RoutingDecision, Tier } from '@/lib/types';
import { TIER_ICON, TIER_LABEL, TierBadge } from './TierBadge';
import { formatTokens } from './tokens';

const TIERS: Tier[] = ['quick', 'thoughtful', 'deep'];

/**
 * DEMO.md Beats 2-3: the chip is the whole routing story. Hover explains the decision,
 * click overrides it — and the override pins the branch, which is the router's teacher.
 */
export function RoutingChip({
  routing,
  pinnedTier,
  onPin,
}: {
  routing: RoutingDecision;
  pinnedTier: Tier | null;
  onPin: (tier: Tier | null) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <span className="relative inline-flex">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="group inline-flex cursor-pointer items-center gap-1.5 rounded-full"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Click to override"
      >
        <TierBadge tier={routing.tier} size="sm" />
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
              <span className="text-xs font-medium text-white">
                {TIER_ICON[routing.tier]} {TIER_LABEL[routing.tier]}
              </span>
              <span className="font-mono text-xs tabular-nums text-emerald-300">
                ${routing.estCostUsd.toFixed(4)}
              </span>
            </span>
            <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-neutral-400">
              <span>Context</span>
              <span className="tabular-nums text-neutral-200">
                {formatTokens(routing.contextTokens)} tokens
              </span>
              <span>Model</span>
              <span className="truncate text-neutral-200">{routing.model}</span>
              <span>Effort</span>
              <span className="text-neutral-200">{routing.effortNote}</span>
              <span>Complexity</span>
              <span className="text-neutral-200">{routing.complexity}/3</span>
            </span>
            <span className="border-t border-white/10 pt-1.5 text-[11px] leading-snug text-neutral-300">
              {routing.reason}
            </span>
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
            className="absolute bottom-full left-0 z-30 mb-2 flex w-52 flex-col rounded-lg border border-white/15 bg-neutral-950 p-1 shadow-xl"
          >
            <span className="px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-500">
              Pin this branch
            </span>
            {TIERS.map((tier) => (
              <button
                key={tier}
                role="menuitem"
                onClick={() => {
                  onPin(tier);
                  setMenuOpen(false);
                }}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-white/10 ${
                  pinnedTier === tier ? 'text-white' : 'text-neutral-300'
                }`}
              >
                <span aria-hidden>{TIER_ICON[tier]}</span>
                {TIER_LABEL[tier]}
                {pinnedTier === tier && <span className="ml-auto text-[10px]">pinned</span>}
              </button>
            ))}
            <button
              role="menuitem"
              onClick={() => {
                onPin(null);
                setMenuOpen(false);
              }}
              className={`mt-0.5 flex items-center gap-2 rounded border-t border-white/10 px-2 py-1.5 text-left text-xs hover:bg-white/10 ${
                pinnedTier === null ? 'text-white' : 'text-neutral-300'
              }`}
            >
              <span aria-hidden>✨</span>
              Auto
              {pinnedTier === null && <span className="ml-auto text-[10px]">active</span>}
            </button>
          </span>
        </>
      )}
    </span>
  );
}
