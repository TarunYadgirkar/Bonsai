'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BranchResponse, ChatResponse, StateResponse, Tier } from '@/lib/types';
import { ChatPane } from './ChatPane';
import { TreeSidebar } from './TreeSidebar';

/** Pure fetch — returns data, touches no state, so effects can own their own setState. */
async function fetchState(): Promise<StateResponse> {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error(`GET /api/state → ${res.status}`);
  return res.json();
}

const describe = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/**
 * Person A territory (AGENTS.md): this consumes the API routes and nothing else.
 * No lib/ engine code is imported here — only the frozen types from lib/types.ts.
 */
export function Workspace() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [branching, setBranching] = useState(false);
  /*
   * Pins live here, keyed by branch, because /api/chat reads pinnedTier off the
   * request and does not persist it onto the Conversation. Sending it on every
   * message is what makes the override stick for the whole branch.
   */
  const [pins, setPins] = useState<Record<string, Tier | null>>({});

  const applyState = useCallback((data: StateResponse) => {
    setState(data);
    // Only seed the selection; don't yank the user back to the root on refetch.
    setActiveId((current) => current ?? data.rootId);
    setError(null);
  }, []);

  const loadState = useCallback(async () => {
    try {
      applyState(await fetchState());
    } catch (err) {
      setError(describe(err));
    }
  }, [applyState]);

  useEffect(() => {
    let cancelled = false;
    fetchState().then(
      (data) => !cancelled && applyState(data),
      (err) => !cancelled && setError(describe(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [applyState]);

  const send = async (content: string) => {
    if (!activeId) return;
    setSending(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId: activeId,
          content,
          pinnedTier: pins[activeId] ?? null,
        }),
      });
      if (!res.ok) throw new Error(`POST /api/chat → ${res.status}`);
      const data: ChatResponse = await res.json();

      // Optimistically append so the thread updates without a full refetch;
      // loadState() then reconciles with whatever the engine actually stored.
      setState((prev) =>
        prev
          ? {
              ...prev,
              conversations: prev.conversations.map((c) =>
                c.id === data.branchId
                  ? { ...c, messages: [...c.messages, data.message] }
                  : c,
              ),
            }
          : prev,
      );
      await loadState();
    } catch (err) {
      setError(describe(err));
    } finally {
      setSending(false);
    }
  };

  const branch = async (selection: string) => {
    if (!activeId) return;
    setBranching(true);
    try {
      const res = await fetch('/api/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: activeId, selection }),
      });
      if (!res.ok) throw new Error(`POST /api/branch → ${res.status}`);
      const data: BranchResponse = await res.json();
      applyState(await fetchState());
      setActiveId(data.node.id); // drop the user straight into the new branch
    } catch (err) {
      setError(describe(err));
    } finally {
      setBranching(false);
    }
  };

  const pin = (tier: Tier | null) => {
    if (!activeId) return;
    setPins((prev) => ({ ...prev, [activeId]: tier }));
  };

  if (error && !state) {
    return (
      <main className="flex flex-1 items-center justify-center bg-neutral-900 p-8">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold text-white">Bonsai</h1>
          <p className="mt-3 text-sm text-neutral-400">
            The UI is up, but the engine isn&apos;t answering yet.
          </p>
          <p className="mt-2 font-mono text-xs text-neutral-600">{error}</p>
          <p className="mt-3 text-xs text-neutral-500">
            Person B owns <code>app/api/**</code>. This pane renders as soon as{' '}
            <code>GET /api/state</code> returns a StateResponse.
          </p>
          <button
            onClick={loadState}
            className="mt-5 rounded-lg border border-white/15 px-4 py-1.5 text-xs text-white hover:bg-white/5"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="flex flex-1 items-center justify-center bg-neutral-900">
        <p className="text-sm text-neutral-500">Loading conversation…</p>
      </main>
    );
  }

  const active =
    state.conversations.find((c) => c.id === activeId) ??
    state.conversations.find((c) => c.id === state.rootId) ??
    state.conversations[0];

  return (
    <main className="flex min-h-0 flex-1">
      <TreeSidebar nodes={state.tree} activeId={active?.id ?? null} onSelect={setActiveId} />
      {active ? (
        <ChatPane
          // Remount per conversation so draft + text selection reset with the branch.
          key={active.id}
          conversation={active}
          onSend={send}
          onBranch={branch}
          onPin={pin}
          pinnedTier={pins[active.id] ?? active.pinnedTier ?? null}
          sending={sending}
          branching={branching}
        />
      ) : (
        <section className="flex flex-1 items-center justify-center bg-neutral-900">
          <p className="text-sm text-neutral-500">No conversation selected.</p>
        </section>
      )}
    </main>
  );
}
