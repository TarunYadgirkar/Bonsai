'use client';

import type { BranchNode, Tier } from '@/lib/types';
import { TierBadge } from './TierBadge';
import { formatTokens, formatUsd } from './tokens';
import { CANVAS_WIDTH, layoutTree, type PlacedNode } from './treeLayout';

/** Per-node figures the tree can't derive from BranchNode alone. Supplied by Workspace. */
export interface NodeStats {
  /** Context tokens on screen for this branch — same formula as the chat header. */
  contextTokens: number;
  /** Everything this branch has spent, summed from the inference log. */
  costUsd: number | null;
  /** Insights this branch merged up into its parent. */
  mergedInsights: number;
}

export interface SessionTotals {
  costUsd: number;
  inputTokens: number;
}

/**
 * Tier accent for the graph. The badge palette (TierBadge) stays as-is — this is the
 * quieter card/edge tint that the legend calls out, running cheap → costly as
 * emerald → sky → violet so the tree reads as a spend gradient at a glance.
 */
const ACCENT: Record<Tier, { border: string; bg: string; kicker: string; stroke: string }> = {
  quick: {
    border: 'border-emerald-400/30',
    bg: 'bg-emerald-400/[0.07]',
    kicker: 'text-emerald-300',
    stroke: 'rgba(110,231,183,.5)',
  },
  thoughtful: {
    border: 'border-sky-400/30',
    bg: 'bg-sky-400/[0.07]',
    kicker: 'text-sky-300',
    stroke: 'rgba(125,211,252,.5)',
  },
  deep: {
    border: 'border-violet-400/30',
    bg: 'bg-violet-400/[0.07]',
    kicker: 'text-violet-300',
    stroke: 'rgba(167,139,250,.5)',
  },
};

/** A branch that hasn't been answered yet has no tier to tint with. */
const NEUTRAL = {
  border: 'border-white/10',
  bg: 'bg-white/[0.03]',
  kicker: 'text-emerald-300',
  stroke: 'rgba(255,255,255,.18)',
};

const accentOf = (tier: Tier | null) => (tier ? ACCENT[tier] : NEUTRAL);

function NodeCard({
  placed,
  stats,
  isActive,
  isFlashing,
  onSelect,
}: {
  placed: PlacedNode;
  stats: NodeStats | undefined;
  isActive: boolean;
  isFlashing: boolean;
  onSelect: (id: string) => void;
}) {
  const { node, variant, x, y, width, height } = placed;
  const accent = accentOf(node.lastTier);

  const shell =
    variant === 'root'
      ? 'border-white/15 bg-white/[0.06]'
      : variant === 'archived'
        ? 'border-white/[0.09] bg-transparent opacity-55 hover:opacity-80'
        : `${accent.border} ${accent.bg}`;

  /*
   * Selection sits on `outline` with an offset rather than `ring`, so it reads as a halo a
   * couple of pixels clear of the card instead of thickening its border into a muddy 2px edge.
   */
  const halo = isFlashing
    ? 'outline-2 outline-offset-2 outline-emerald-300/70'
    : isActive
      ? 'outline-1 outline-offset-2 outline-white/30'
      : 'outline-1 outline-offset-2 outline-transparent';

  return (
    <button
      // The merge animation looks this up to find where the insight should fly.
      data-node-id={node.id}
      onClick={() => onSelect(node.id)}
      style={{ left: x, top: y, width, height }}
      className={`absolute flex flex-col justify-center overflow-hidden rounded-lg border px-3 text-left shadow-sm shadow-black/30 outline transition-[top,left,width,outline-color,background-color,border-color,opacity] duration-500 hover:border-white/25 ${shell} ${halo}`}
    >
      {/* Kicker — the pruning ratio this branch inherited, in its tier's tint. */}
      {variant === 'branch' &&
        node.prunedPct !== null &&
        node.availableTokens !== null &&
        node.inheritedTokens !== null && (
          <div className={`text-[10px] tabular-nums ${accent.kicker}`}>
            {node.availableTokens.toLocaleString()} → {node.inheritedTokens.toLocaleString()} ·{' '}
            {node.prunedPct.toFixed(1)}% pruned
          </div>
        )}

      <div className={`flex items-center gap-2 ${variant === 'branch' ? 'mt-1.5' : ''}`}>
        <span
          className={`truncate ${
            variant === 'archived'
              ? 'text-[11px] text-neutral-400'
              : 'text-xs font-medium text-white'
          }`}
        >
          {node.title}
        </span>
        {variant === 'branch' && node.lastTier && (
          <span className="ml-auto shrink-0">
            <TierBadge tier={node.lastTier} size="sm" />
          </span>
        )}
      </div>

      <div className="mt-1 flex gap-2.5 truncate text-[10px] tabular-nums text-neutral-500">
        {variant === 'root' ? (
          <>
            <span>root</span>
            <span>{node.messageCount} msg</span>
            {stats && <span>{formatTokens(stats.contextTokens)} tokens</span>}
          </>
        ) : variant === 'archived' ? (
          <span className="text-neutral-600">
            archived
            {stats && stats.mergedInsights > 0 && (
              <> · merged {stats.mergedInsights} insight{stats.mergedInsights === 1 ? '' : 's'}</>
            )}
          </span>
        ) : (
          <>
            <span>{node.messageCount} msg</span>
            {stats?.costUsd != null && (
              <span className="font-mono">{formatUsd(stats.costUsd)}</span>
            )}
            {node.pinnedTier && <span className="text-neutral-400">pinned</span>}
          </>
        )}
      </div>
    </button>
  );
}

export function TreeSidebar({
  nodes,
  activeId,
  onSelect,
  onOpenEconomics,
  flashId,
  stats,
  session,
}: {
  nodes: BranchNode[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onOpenEconomics: () => void;
  /** Node a merged insight just landed on — pulses for a beat. */
  flashId: string | null;
  stats: Record<string, NodeStats>;
  /** Session spend for the Economics button. Null until the first inference is logged. */
  session: SessionTotals | null;
}) {
  const layout = layoutTree(nodes);

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-white/10 bg-neutral-950"
      style={{ width: CANVAS_WIDTH }}
    >
      <div className="border-b border-white/10 px-4 py-3">
        <h1 className="text-sm font-semibold tracking-tight text-white">Bonsai</h1>
        <p className="mt-0.5 text-[11px] text-neutral-500">Grow conversations as trees</p>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="relative" style={{ height: layout.height }}>
          <svg
            width={CANVAS_WIDTH}
            height={layout.height}
            className="pointer-events-none absolute inset-0"
            aria-hidden
          >
            {layout.spines.map((spine) => (
              <path
                key={`spine-${spine.id}`}
                d={`M${spine.x} ${spine.y1} V${spine.y2}`}
                stroke="rgba(255,255,255,.09)"
                strokeWidth={1}
                fill="none"
              />
            ))}
            {layout.stubs.map((stub) => (
              <path
                key={`stub-${stub.id}`}
                d={stub.d}
                stroke={stub.dashed ? 'rgba(255,255,255,.12)' : accentOf(stub.tier).stroke}
                strokeWidth={stub.dashed ? 1 : 1.5}
                strokeDasharray={stub.dashed ? '3 5' : undefined}
                fill="none"
              />
            ))}
          </svg>

          {layout.nodes.map((placed) => (
            <NodeCard
              key={placed.node.id}
              placed={placed}
              stats={stats[placed.node.id]}
              isActive={placed.node.id === activeId}
              isFlashing={placed.node.id === flashId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>

      <div className="flex shrink-0 justify-between border-t border-white/[0.08] px-5 py-2 text-[10px] text-neutral-500">
        <span>Edge tint = tier of last answer</span>
        <span>Kicker = available → inherited</span>
      </div>

      {/* DEMO.md Beat 5 opens from here. */}
      <div className="border-t border-white/10 p-2">
        <button
          onClick={onOpenEconomics}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-neutral-300 transition-colors hover:bg-white/5"
        >
          <span aria-hidden>📊</span>
          Economics
          <span className="ml-auto font-mono text-[10px] tabular-nums text-neutral-600">
            {session
              ? `${formatUsd(session.costUsd)} · ${formatTokens(session.inputTokens)} in`
              : 'tokens · spend'}
          </span>
        </button>
      </div>
    </aside>
  );
}
