'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowCounterClockwise,
  ChartBar,
  Plant,
  Plugs,
  Plus,
  TreeStructure,
} from '@phosphor-icons/react';
import type { BranchNode, Effort } from '@/lib/types';
import { CutStrip } from './CutStrip';
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
  /** Model of the last answer, e.g. "Opus 5.5". Null until the branch has been answered. */
  modelLabel: string | null;
  /** Effort of the last answer — also what tints the card's edge. */
  effort: Effort | null;
}

export interface SessionTotals {
  costUsd: number;
  inputTokens: number;
}

/**
 * The season scale: a branch's effort read as a stage of growth, cheap → expensive. Drawn on
 * the edge that grew the branch. Data color, never text color (the summer step fails contrast).
 */
export function seasonColor(effort: Effort | null | undefined): string {
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

function BranchFigures({ node, stats }: { node: BranchNode; stats: NodeStats | undefined }) {
  if (node.availableTokens === null || node.inheritedTokens === null) return null;
  return (
    <>
      <CutStrip available={node.availableTokens} kept={node.inheritedTokens} />
      <span className="flex items-baseline gap-2 text-[11px] text-ink-faint">
        <span className="tnum text-ink-muted">
          {node.inheritedTokens.toLocaleString()} of {formatTokens(node.availableTokens)}
        </span>
        <span>sent</span>
        {stats?.costUsd != null && <span className="tnum ml-auto">{formatUsd(stats.costUsd)}</span>}
      </span>
    </>
  );
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

  const shell =
    variant === 'archived'
      ? 'bg-transparent text-ink-faint hover:bg-surface-raised/70'
      : isActive
        ? 'bg-accent-wash shadow-bud ring-2 ring-accent/70'
        : 'bg-surface-raised shadow-bud hover:ring-1 hover:ring-rule-strong';
  const flash = isFlashing ? 'ring-4 ring-accent-bright/60' : '';

  return (
    <button
      // The merge animation looks this up to find where the insight should fly.
      data-node-id={node.id}
      onClick={() => onSelect(node.id)}
      aria-current={isActive ? 'true' : undefined}
      style={{ left: x, top: y, width, height }}
      className={`absolute flex flex-col justify-center gap-1.5 overflow-hidden rounded-[var(--radius-bud)] px-3 text-left transition-[top,left,width,box-shadow,background-color] duration-300 ${shell} ${flash}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`truncate ${
            variant === 'root'
              ? 'font-display text-[17px] font-semibold leading-tight text-ink'
              : variant === 'archived'
                ? 'text-xs'
                : 'text-[13px] font-medium text-ink'
          }`}
        >
          {node.title}
        </span>
        {variant === 'branch' && stats?.modelLabel && (
          <span className="ml-auto shrink-0">
            <ModeBadge modelLabel={stats.modelLabel} effort={stats.effort ?? undefined} size="sm" />
          </span>
        )}
      </span>

      {variant === 'branch' && <BranchFigures node={node} stats={stats} />}

      {variant === 'root' && (
        <span className="flex gap-3 text-[11px] text-ink-faint">
          <span>Trunk</span>
          <span className="tnum">{node.messageCount} messages</span>
          {stats && <span className="tnum">{formatTokens(stats.contextTokens)} tokens</span>}
        </span>
      )}

      {variant === 'archived' && stats && stats.mergedInsights > 0 && (
        <span className="text-[11px]">
          Merged {stats.mergedInsights} insight{stats.mergedInsights === 1 ? '' : 's'}, then archived
        </span>
      )}
    </button>
  );
}

/** The canvas follows its container on narrow screens, so cards shrink instead of scrolling sideways. */
function useCanvasWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(CANVAS_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(Math.min(CANVAS_WIDTH, entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function SeasonLegend() {
  return (
    <span className="flex items-center gap-1.5" aria-hidden>
      {(['low', 'medium', 'high'] as const).map((e) => (
        <span key={e} className="h-1.5 w-3 rounded-full" style={{ background: seasonColor(e) }} />
      ))}
    </span>
  );
}

const FOOTER_ROW =
  'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] px-2.5 py-2 md:gap-2 md:px-3 text-left text-[13px] transition-colors hover:bg-surface-sunk disabled:opacity-40 md:w-full';

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
  /** Session spend for the spend button. Null until the first inference is logged. */
  session: SessionTotals | null;
}) {
  const [canvasRef, canvasWidth] = useCanvasWidth();
  const layout = layoutTree(nodes, canvasWidth);
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
      className="flex max-h-[40dvh] w-full shrink-0 flex-col overflow-hidden bg-surface md:max-h-none md:w-[var(--canvas-w)] md:shadow-[inset_-1px_0_0_var(--rule)]"
      style={{ '--canvas-w': `${CANVAS_WIDTH}px` } as CSSProperties}
    >
      <header className="flex items-center gap-3 px-4 pb-2 pt-3 md:items-start md:px-5 md:pb-3 md:pt-5">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-[22px] font-bold leading-none text-ink md:text-[26px]">
            <Plant weight="duotone" className="h-6 w-6 text-accent" aria-hidden />
            Bonsai
          </h1>
          <p className="mt-2 hidden max-w-[30ch] text-[13px] leading-snug text-ink-muted md:block">
            Side questions branch off with a small brief. One line merges back.
          </p>
        </div>
        <button
          onClick={startNewChat}
          disabled={creating}
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink shadow-bud transition-colors hover:bg-accent-wash disabled:opacity-40"
        >
          <Plus weight="bold" className="h-3.5 w-3.5" aria-hidden />
          {creating ? 'Planting…' : 'New tree'}
        </button>
      </header>

      <div
        ref={canvasRef}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        aria-label="Conversation tree"
      >
        <div className="relative" style={{ height: layout.height }}>
          <svg
            width={canvasWidth}
            height={layout.height}
            className="pointer-events-none absolute inset-0"
            aria-hidden
          >
            {layout.spines.map((spine) => (
              <path
                key={`spine-${spine.id}`}
                d={`M${spine.x} ${spine.y1} V${spine.y2}`}
                stroke="var(--rule-strong)"
                strokeWidth={1.5}
                fill="none"
              />
            ))}
            {layout.stubs.map((stub) => {
              const active = stub.id === activeId;
              return (
                <path
                  key={`stub-${stub.id}`}
                  d={stub.d}
                  stroke={
                    stub.dashed
                      ? 'var(--rule-strong)'
                      : active
                        ? 'var(--accent)'
                        : seasonColor(stats[stub.id]?.effort)
                  }
                  strokeWidth={stub.dashed ? 1.25 : active ? 2.5 : 2}
                  strokeDasharray={stub.dashed ? '3 5' : undefined}
                  strokeLinecap="round"
                  fill="none"
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

      <div className="hidden shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[11px] text-ink-faint shadow-[inset_0_1px_0_var(--rule)] md:flex">
        <span className="flex items-center gap-1.5">
          <SeasonLegend />
          Edge: effort, low to high
        </span>
        <span className="flex items-center gap-1.5">
          <span className="flex h-1.5 w-8 overflow-hidden rounded-[2px]" aria-hidden>
            <span className="w-1 bg-[color:var(--kept)]" />
            <span className="cut-pruned flex-1" />
          </span>
          Bar: context sent vs available
        </span>
      </div>

      <nav
        className="flex shrink-0 gap-0.5 overflow-x-auto p-2 shadow-[inset_0_1px_0_var(--rule)] md:grid md:grid-cols-2 md:overflow-visible"
        aria-label="Garden"
      >
        <button onClick={onOpenEconomics} className={`${FOOTER_ROW} text-ink md:col-span-2`}>
          <ChartBar className="h-4 w-4 text-accent" aria-hidden />
          <span className="font-medium">Spend</span>
          <span className="tnum ml-auto hidden text-[11px] text-ink-faint md:inline">
            {session ? `${formatUsd(session.costUsd)} · ${formatTokens(session.inputTokens)} in` : 'No calls yet'}
          </span>
        </button>
        <button onClick={runLoadDemo} disabled={loadingDemo} className={`${FOOTER_ROW} text-ink-muted`}>
          <TreeStructure className="h-4 w-4" aria-hidden />
          {loadingDemo ? (
            'Planting…'
          ) : (
            <span>
              Example<span className="hidden md:inline"> tree</span>
            </span>
          )}
        </button>
        <a href="/connect" className={`${FOOTER_ROW} text-ink-muted`}>
          <Plugs className="h-4 w-4" aria-hidden />
          <span>
            <span className="hidden md:inline">Use in </span>claude.ai
          </span>
        </a>
        {/*
         * Two-step rather than a confirm() dialog: a browser modal blocks the page, and this
         * discards the current garden, so a stray click must not be enough.
         */}
        <button
          onClick={() => (confirming ? runReset() : setConfirming(true))}
          onBlur={() => setConfirming(false)}
          disabled={resetting}
          className={`${FOOTER_ROW} ${confirming ? 'bg-danger/10 text-danger hover:bg-danger/15' : 'text-ink-muted'}`}
        >
          <ArrowCounterClockwise className="h-4 w-4" aria-hidden />
          {resetting ? (
            'Clearing…'
          ) : confirming ? (
            'Click again to empty'
          ) : (
            <span>
              Reset<span className="hidden md:inline"> garden</span>
            </span>
          )}
        </button>
      </nav>
    </aside>
  );
}
