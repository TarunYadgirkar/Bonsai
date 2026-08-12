'use client';

import { useState, type CSSProperties } from 'react';
import type { BranchNode, Effort } from '@/lib/types';
import { ModeBadge } from './ModeBadge';
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
  /** Model of the last answer, e.g. "Opus 5". Null until the branch has been answered. */
  modelLabel: string | null;
  /** Effort of the last answer — also what tints the card and its edge. */
  effort: Effort | null;
}

export interface SessionTotals {
  costUsd: number;
  inputTokens: number;
}

/**
 * The season scale: a branch's effort read as a stage of growth, cheap → expensive. Used for the
 * edge that grew it and the pruning figure it inherited. Not a cost-purple ramp (see DESIGN.md).
 */
function seasonColor(effort: Effort | null | undefined): string {
  switch (effort) {
    case 'high':
    case 'max':
      return 'var(--season-ember)';
    case 'medium':
      return 'var(--season-summer)';
    default:
      return 'var(--season-young)';
  }
}

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
  const season = seasonColor(stats?.effort);

  const shell =
    variant === 'root'
      ? 'border-rule-strong bg-paper-sunk'
      : variant === 'archived'
        ? 'border-rule bg-transparent opacity-55 hover:opacity-90'
        : isActive
          ? 'border-moss bg-moss-wash'
          : 'border-rule bg-paper-raised hover:border-rule-strong';

  // Selection is a moss halo a couple of pixels clear of the card; a merge flashes brighter.
  const halo = isFlashing
    ? 'outline-2 outline-offset-2 outline-[color:var(--moss-bright)]'
    : isActive
      ? 'outline-1 outline-offset-2 outline-[color:var(--moss)]'
      : 'outline-1 outline-offset-2 outline-transparent';

  return (
    <button
      // The merge animation looks this up to find where the insight should fly.
      data-node-id={node.id}
      onClick={() => onSelect(node.id)}
      style={{ left: x, top: y, width, height }}
      className={`absolute flex flex-col justify-center overflow-hidden rounded-lg border px-3 text-left outline transition-[top,left,width,outline-color,background-color,border-color,opacity] duration-500 ${shell} ${halo}`}
    >
      {/* Kicker — the pruning this branch inherited, inked in its season. */}
      {variant === 'branch' &&
        node.prunedPct !== null &&
        node.availableTokens !== null &&
        node.inheritedTokens !== null && (
          <div className="tnum text-[10px]" style={{ color: season }}>
            {node.availableTokens.toLocaleString()} → {node.inheritedTokens.toLocaleString()} ·{' '}
            {node.prunedPct.toFixed(1)}% pruned
          </div>
        )}

      <div className={`flex items-center gap-2 ${variant === 'branch' ? 'mt-1.5' : ''}`}>
        <span
          className={`truncate ${
            variant === 'archived'
              ? 'text-[11px] text-bark'
              : variant === 'root'
                ? 'font-display text-[15px] leading-none text-ink'
                : 'text-xs font-medium text-ink'
          }`}
        >
          {node.title}
        </span>
        {variant === 'branch' && stats?.modelLabel && (
          <span className="ml-auto shrink-0">
            <ModeBadge modelLabel={stats.modelLabel} effort={stats.effort ?? undefined} size="sm" />
          </span>
        )}
      </div>

      <div className="tnum mt-1 flex gap-2.5 truncate text-[10px] text-ink-soft">
        {variant === 'root' ? (
          <>
            <span className="text-bark">trunk</span>
            <span>{node.messageCount} msg</span>
            {stats && <span>{formatTokens(stats.contextTokens)} tokens</span>}
          </>
        ) : variant === 'archived' ? (
          <span className="text-bark">
            archived
            {stats && stats.mergedInsights > 0 && (
              <> · merged {stats.mergedInsights} insight{stats.mergedInsights === 1 ? '' : 's'}</>
            )}
          </span>
        ) : (
          <>
            <span>{node.messageCount} msg</span>
            {stats?.costUsd != null && <span>{formatUsd(stats.costUsd)}</span>}
            {node.pinnedTier && <span className="text-moss">pinned</span>}
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
  onReset,
  onNewChat,
  onLoadDemo,
  flashId,
  stats,
  session,
}: {
  nodes: BranchNode[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onOpenEconomics: () => void;
  /** Empties this session's garden back to a single fresh root. */
  onReset: () => Promise<void>;
  /** Starts an empty root conversation alongside the existing trees. */
  onNewChat: () => Promise<void>;
  /** Seeds the Berkeley Clubs example tree into this session. */
  onLoadDemo: () => Promise<void>;
  /** Node a merged insight just landed on — pulses for a beat. */
  flashId: string | null;
  stats: Record<string, NodeStats>;
  /** Session spend for the Economics button. Null until the first inference is logged. */
  session: SessionTotals | null;
}) {
  const layout = layoutTree(nodes);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);

  const startNewChat = async () => {
    setCreating(true);
    try {
      await onNewChat();
    } finally {
      setCreating(false);
    }
  };

  const runReset = async () => {
    setResetting(true);
    try {
      await onReset();
    } finally {
      setResetting(false);
      setConfirming(false);
    }
  };

  const runLoadDemo = async () => {
    setLoadingDemo(true);
    try {
      await onLoadDemo();
    } finally {
      setLoadingDemo(false);
    }
  };

  return (
    <aside
      className="flex max-h-[45dvh] w-full shrink-0 flex-col overflow-hidden border-b border-rule bg-paper-raised md:max-h-none md:w-[var(--canvas-w)] md:border-b-0 md:border-r"
      style={{ '--canvas-w': `${CANVAS_WIDTH}px` } as CSSProperties}
    >
      <div className="flex items-start justify-between gap-2 border-b border-rule px-5 py-4">
        <div className="min-w-0">
          <p className="eyebrow">the garden</p>
          <h1 className="font-display text-2xl leading-none tracking-tight text-ink">Bonsai</h1>
          <p className="mt-1 text-[11px] text-ink-soft">prune the conversation to its living wood</p>
        </div>
        <button
          onClick={startNewChat}
          disabled={creating}
          className="shrink-0 rounded-md border border-moss px-2.5 py-1 text-[11px] font-medium text-moss transition-colors hover:bg-moss-wash disabled:opacity-40"
        >
          {creating ? 'Planting…' : 'New tree'}
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="relative" style={{ height: layout.height }}>
          <svg
            width={CANVAS_WIDTH}
            height={layout.height}
            className="pointer-events-none absolute inset-0"
            aria-hidden
          >
            {/* Boughs: a parent's vertical run down past its children. */}
            {layout.spines.map((spine) => (
              <path
                key={`spine-${spine.id}`}
                d={`M${spine.x} ${spine.y1} V${spine.y2}`}
                stroke="var(--rule-strong)"
                strokeWidth={1}
                fill="none"
              />
            ))}
            {/* Cuts: each branch grew from a bough — active path in moss, archived dashed bark. */}
            {layout.stubs.map((stub) => {
              const active = stub.id === activeId;
              return (
                <path
                  key={`stub-${stub.id}`}
                  d={stub.d}
                  stroke={
                    stub.dashed ? 'var(--bark)' : active ? 'var(--moss)' : seasonColor(stats[stub.id]?.effort)
                  }
                  strokeWidth={stub.dashed ? 1 : active ? 2 : 1.5}
                  strokeDasharray={stub.dashed ? '3 5' : undefined}
                  strokeLinecap="round"
                  fill="none"
                  opacity={stub.dashed ? 0.6 : 0.9}
                />
              );
            })}
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

      <div className="flex shrink-0 justify-between border-t border-rule px-5 py-2 text-[10px] text-bark">
        <span>edge · effort of last answer</span>
        <span>kicker · available → kept</span>
      </div>

      <div className="border-t border-rule p-2">
        <button
          onClick={onOpenEconomics}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-ink-soft transition-colors hover:bg-paper-sunk"
        >
          <span className="font-medium text-ink">Economics</span>
          <span className="tnum ml-auto text-[10px] text-bark">
            {session
              ? `${formatUsd(session.costUsd)} · ${formatTokens(session.inputTokens)} in`
              : 'tokens · spend'}
          </span>
        </button>

        <button
          onClick={runLoadDemo}
          disabled={loadingDemo}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-bark transition-colors hover:bg-paper-sunk hover:text-ink-soft disabled:opacity-40"
        >
          {loadingDemo ? 'Planting…' : 'Load Berkeley demo'}
          <span className="ml-auto text-[10px] text-bark">example tree</span>
        </button>

        {/*
         * Two-step rather than a confirm() dialog: a browser modal blocks the page, and this
         * discards the current garden, so a stray click must not be enough.
         */}
        <button
          onClick={() => (confirming ? runReset() : setConfirming(true))}
          onBlur={() => setConfirming(false)}
          disabled={resetting}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors disabled:opacity-40 ${
            confirming
              ? 'bg-[color:var(--ember)]/10 text-ember hover:bg-[color:var(--ember)]/15'
              : 'text-bark hover:bg-paper-sunk hover:text-ink-soft'
          }`}
        >
          {resetting ? 'Clearing…' : confirming ? 'Empty the garden?' : 'Reset garden'}
          <span className="ml-auto text-[10px] text-bark">
            {confirming ? 'click again' : 'back to empty'}
          </span>
        </button>
      </div>
    </aside>
  );
}
