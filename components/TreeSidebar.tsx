'use client';

import type { BranchNode } from '@/lib/types';
import { TierBadge } from './TierBadge';
import { formatTokens } from './tokens';

/**
 * Indented tree, per PLAN.md M1 ("don't gold-plate" — reactflow is an M2+ option).
 * Renders depth-first from the root so children sit under their parent.
 */
function orderNodes(nodes: BranchNode[]): BranchNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: BranchNode[] = [];
  const seen = new Set<string>();

  const walk = (node: BranchNode) => {
    if (seen.has(node.id)) return; // defensive: a cycle would otherwise hang the render
    seen.add(node.id);
    out.push(node);
    for (const childId of node.childIds) {
      const child = byId.get(childId);
      if (child) walk(child);
    }
  };

  nodes.filter((n) => n.parentId === null).forEach(walk);
  // Anything unreachable from a root still gets rendered rather than silently dropped.
  nodes.forEach((n) => !seen.has(n.id) && walk(n));
  return out;
}

export function TreeSidebar({
  nodes,
  activeId,
  onSelect,
}: {
  nodes: BranchNode[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-white/10 bg-neutral-950">
      <div className="border-b border-white/10 px-4 py-3">
        <h1 className="text-sm font-semibold tracking-tight text-white">Bonsai</h1>
        <p className="mt-0.5 text-[11px] text-neutral-500">
          Grow conversations as trees
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {orderNodes(nodes).map((node) => {
          const isActive = node.id === activeId;
          return (
            <button
              key={node.id}
              onClick={() => onSelect(node.id)}
              style={{ paddingLeft: `${node.depth * 14 + 10}px` }}
              className={`group mb-0.5 flex w-full flex-col items-start gap-1 rounded-md py-2 pr-2 text-left transition-colors ${
                isActive ? 'bg-white/10' : 'hover:bg-white/5'
              } ${node.archived ? 'opacity-45' : ''}`}
            >
              <span className="flex w-full items-center gap-1.5">
                {node.depth > 0 && (
                  <span aria-hidden className="text-neutral-600">
                    └
                  </span>
                )}
                <span
                  className={`truncate text-xs ${isActive ? 'text-white' : 'text-neutral-300'}`}
                >
                  {node.title}
                </span>
                {node.archived && (
                  <span className="ml-auto shrink-0 text-[10px] text-neutral-500">
                    archived
                  </span>
                )}
              </span>

              <span className="flex flex-wrap items-center gap-1.5 pl-1 text-[10px] text-neutral-500">
                <span>{node.messageCount} msg</span>
                {/* Edge economics — the pruned-% badge DEMO.md Beat 2 points at. */}
                {node.prunedPct !== null && (
                  <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 font-medium text-emerald-300">
                    {node.prunedPct.toFixed(1)}% pruned
                  </span>
                )}
                {node.inheritedTokens !== null && node.availableTokens !== null && (
                  <span className="tabular-nums">
                    {formatTokens(node.inheritedTokens)}/
                    {formatTokens(node.availableTokens)}
                  </span>
                )}
                {node.lastTier && <TierBadge tier={node.lastTier} size="sm" />}
                {node.pinnedTier && (
                  <span className="text-neutral-400">pinned</span>
                )}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
