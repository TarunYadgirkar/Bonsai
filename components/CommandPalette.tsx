'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { searchGarden, type SearchHit } from '@/lib/search';
import type { Conversation } from '@/lib/types';

interface Action {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * ⌘K palette: search every branch, message, and insight in the garden, or run a quick action.
 * Pure client work — the whole garden is already in state, so each keystroke just rescans.
 */
export function CommandPalette({
  conversations,
  onSelectBranch,
  onNewChat,
  onOpenEconomics,
  onExport,
  activeIsBranch,
  onClose,
}: {
  conversations: Conversation[];
  onSelectBranch: (id: string) => void;
  onNewChat: () => void;
  onOpenEconomics: () => void;
  /** Download the garden — or, when scope is 'branch', the active subtree. */
  onExport: (format: 'md' | 'json', scope: 'garden' | 'branch') => void;
  activeIsBranch: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const hits: SearchHit[] = useMemo(
    () => searchGarden(conversations, query),
    [conversations, query],
  );

  const actions: Action[] = useMemo(() => {
    if (query.trim()) return [];
    return [
      { id: 'new-chat', label: 'New chat', hint: 'a second tree', run: onNewChat },
      { id: 'economics', label: 'Open economics', hint: 'the cost ledger', run: onOpenEconomics },
      {
        id: 'export-md',
        label: 'Export garden as Markdown',
        hint: 'every tree, one file',
        run: () => onExport('md', 'garden'),
      },
      {
        id: 'export-json',
        label: 'Export garden as JSON',
        hint: 'portable backup',
        run: () => onExport('json', 'garden'),
      },
      ...(activeIsBranch
        ? [
            {
              id: 'export-branch',
              label: 'Export this branch as Markdown',
              hint: 'the open subtree',
              run: () => onExport('md', 'branch'),
            },
          ]
        : []),
    ];
  }, [query, onNewChat, onOpenEconomics, onExport, activeIsBranch]);

  /** Flat keyboard order: actions first, then hits. */
  const rowCount = actions.length + hits.length;
  const clampedCursor = Math.min(cursor, Math.max(0, rowCount - 1));

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-row="${clampedCursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [clampedCursor]);

  const activate = (row: number) => {
    if (row < actions.length) {
      actions[row].run();
    } else {
      const hit = hits[row - actions.length];
      if (hit) onSelectBranch(hit.branchId);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 pt-[14vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-rule bg-paper shadow-lg"
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, rowCount - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter' && rowCount > 0) {
              e.preventDefault();
              activate(clampedCursor);
            }
          }}
          placeholder="Search branches, messages, insights…"
          className="w-full border-b border-rule bg-paper px-4 py-3 text-sm text-ink placeholder:text-bark focus:outline-none"
        />
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1">
          {actions.map((action, i) => (
            <button
              key={action.id}
              data-row={i}
              onClick={() => activate(i)}
              onMouseEnter={() => setCursor(i)}
              className={`flex w-full items-baseline gap-2 px-4 py-2 text-left text-sm ${
                clampedCursor === i ? 'bg-moss-wash text-ink' : 'text-ink-soft'
              }`}
            >
              <span>{action.label}</span>
              {action.hint && <span className="text-[10px] text-bark">{action.hint}</span>}
            </button>
          ))}
          {hits.map((hit, i) => {
            const row = actions.length + i;
            return (
              <button
                key={`${hit.branchId}:${hit.kind}`}
                data-row={row}
                onClick={() => activate(row)}
                onMouseEnter={() => setCursor(row)}
                className={`block w-full px-4 py-2 text-left ${
                  clampedCursor === row ? 'bg-moss-wash' : ''
                }`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm text-ink">{hit.branchTitle}</span>
                  <span className="eyebrow shrink-0">{hit.kind}</span>
                </span>
                {hit.kind !== 'title' && (
                  <span className="mt-0.5 block truncate text-[11px] text-ink-soft">
                    {hit.snippet}
                  </span>
                )}
              </button>
            );
          })}
          {query.trim() && hits.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-bark">
              Nothing in the garden matches.
            </p>
          )}
          {!query.trim() && (
            <p className="border-t border-rule px-4 py-2 text-[10px] text-bark">
              type to search · ↑↓ to move · Enter to open · Esc to close
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
