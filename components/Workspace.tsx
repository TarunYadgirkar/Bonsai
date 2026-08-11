'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  BranchResponse,
  ChatResponse,
  Conversation,
  EconomicsResponse,
  MergeResponse,
  ModeSelection,
  StateResponse,
} from '@/lib/types';
import { ChatPane } from './ChatPane';
import { EconomicsPanel } from './EconomicsPanel';
import { MergeFlight, type Flight } from './MergeFlight';
import { TreeSidebar, type NodeStats } from './TreeSidebar';
import { conversationTokens } from './tokens';

/** Pure fetch — returns data, touches no state, so effects can own their own setState. */
async function fetchState(): Promise<StateResponse> {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error(`GET /api/state → ${res.status}`);
  return res.json();
}

/**
 * The tree cards carry per-branch spend, which only the inference log knows. This is
 * decoration on top of the tree — a failure here must never blank the sidebar, so it
 * resolves to null and the cards simply omit the cost.
 */
async function fetchEconomics(): Promise<EconomicsResponse | null> {
  try {
    const res = await fetch('/api/economics', { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const describe = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** Where a merged insight should fly to: the parent's row in the sidebar. */
function nodeCenter(id: string): { x: number; y: number } | null {
  const el = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** How long the landing glow stays up on the parent node and its new insight. */
const FLASH_MS = 2600;

/**
 * The open branch lives in the URL, so reload lands where you were, Back and Forward walk the
 * branches you visited, and a link to a branch opens that branch. Plain history API rather than
 * useSearchParams: this page is prerendered, and reading search params would opt it out of that
 * for a value only the client ever sets.
 */
const BRANCH_PARAM = 'branch';

function branchFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(BRANCH_PARAM);
}

function writeBranchToUrl(id: string, mode: 'push' | 'replace'): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get(BRANCH_PARAM) === id) return;
  url.searchParams.set(BRANCH_PARAM, id);
  const next = `${url.pathname}${url.search}`;
  if (mode === 'push') window.history.pushState({ [BRANCH_PARAM]: id }, '', next);
  else window.history.replaceState({ [BRANCH_PARAM]: id }, '', next);
}

/**
 * The raw selection is chat markdown, so a highlight that clips a bold marker names the tree
 * node `*Reassess once, in week six.** Not`. The node label is on screen for the rest of the
 * demo — send a cleaned title (the contract already has the field) and keep `selection` raw,
 * because the compiler still wants the real text.
 */
function titleFromSelection(selection: string): string {
  const clean = selection.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Branch';
  return clean.length > 42 ? `${clean.slice(0, 42).trimEnd()}…` : clean;
}

/**
 * Person A territory (AGENTS.md): this consumes the API routes and nothing else.
 * No lib/ engine code is imported here — only the frozen types from lib/types.ts.
 */
export function Workspace() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [economics, setEconomics] = useState<EconomicsResponse | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [branching, setBranching] = useState(false);
  /*
   * The server owns pins now (Conversation.pinnedMode). This map holds only the picks made
   * since a branch's last send — each is sent once on the next message, then dropped in favour
   * of the refetched pinnedMode. null means an explicit switch back to Auto, which unpins.
   */
  const [pendingModes, setPendingModes] = useState<Record<string, ModeSelection | null>>({});
  const [merging, setMerging] = useState(false);
  /** A draft from a send that failed while its branch was unmounted — handed back on remount. */
  const [failedDraft, setFailedDraft] = useState<{ branchId: string; content: string } | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  /** The insight that just landed, so the parent node and the line itself can glow. */
  const [merged, setMerged] = useState<{ parentId: string; insightId: string } | null>(null);
  const [economicsOpen, setEconomicsOpen] = useState(false);

  useEffect(() => {
    if (!merged) return;
    const timer = setTimeout(() => setMerged(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [merged]);

  const applyState = useCallback((data: StateResponse) => {
    setState(data);
    setActiveId((current) => {
      if (current) return current; // don't yank the user back to the root on refetch
      // First load: honour ?branch=… if it still exists, else open the root.
      const fromUrl = branchFromUrl();
      const exists = fromUrl && data.conversations.some((c) => c.id === fromUrl);
      return exists ? fromUrl : data.rootId;
    });
    setError(null);
  }, []);

  /** Every selection goes through here so the URL and the view can never disagree. */
  const select = useCallback((id: string) => {
    setActiveId(id);
    writeBranchToUrl(id, 'push');
  }, []);

  // Back and Forward: adopt whatever branch the entry names — but only if it still exists in the
  // current garden, else fall back to the root. A history entry can point at a branch that a reset
  // or demo-load has since removed; without this guard the view would strand on a dead id.
  useEffect(() => {
    const onPop = () => {
      const id = branchFromUrl();
      const exists = id && state?.conversations.some((c) => c.id === id);
      setActiveId(exists ? id : (state?.rootId ?? null));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [state]);

  // Keep the address bar honest for programmatic moves (first load, merge landing, reset).
  useEffect(() => {
    if (activeId) writeBranchToUrl(activeId, 'replace');
  }, [activeId]);

  const loadState = useCallback(async () => {
    try {
      applyState(await fetchState());
    } catch (err) {
      setError(describe(err));
    }
    // Independent of the state load: cost figures refresh, a miss just leaves the old ones.
    const logs = await fetchEconomics();
    if (logs) setEconomics(logs);
  }, [applyState]);

  useEffect(() => {
    let cancelled = false;
    fetchState().then(
      (data) => !cancelled && applyState(data),
      (err) => !cancelled && setError(describe(err)),
    );
    fetchEconomics().then((logs) => !cancelled && logs && setEconomics(logs));
    return () => {
      cancelled = true;
    };
  }, [applyState]);

  /** Pin as the user currently sees it: an unsent pick wins, else the server's persisted pin. */
  const modeFor = (conversation: Conversation): ModeSelection | null =>
    conversation.id in pendingModes
      ? (pendingModes[conversation.id] ?? null)
      : (conversation.pinnedMode ?? null);

  /** Resolves false on failure so the composer can put the user's text back. */
  const send = async (content: string): Promise<boolean> => {
    if (!activeId) return false;
    const branchId = activeId;
    setSending(true);
    try {
      // Mode rides along only when the user changed it since the last send: a manual pick
      // pins the branch server-side, an explicit Auto unpins it. Every other message relies
      // on the persisted pin.
      const hadPending = branchId in pendingModes;
      const pending = pendingModes[branchId];
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          content,
          mode: hadPending ? (pending ?? { mode: 'auto' as const }) : undefined,
        }),
      });
      if (!res.ok) throw new Error(`POST /api/chat → ${res.status}`);
      const data: ChatResponse = await res.json();

      // The server persisted the pick — pinnedMode is the truth from here on. Drop the entry
      // only if it is still the one this request sent: a pick made while the request was in
      // flight has not reached the server and must survive for the next send.
      setPendingModes((prev) => {
        if (!(branchId in prev)) return prev;
        if (!hadPending || prev[branchId] !== pending) return prev;
        const next = { ...prev };
        delete next[branchId];
        return next;
      });

      // Optimistically append so the thread updates without a full refetch;
      // loadState() then reconciles with whatever the engine actually stored. Also carry the
      // just-sent pin onto the conversation so the chip doesn't flicker to Auto during the
      // refetch window (the server has the pin; our local copy shouldn't briefly disagree).
      const sentPin = hadPending ? (pending ?? null) : undefined;
      setState((prev) =>
        prev
          ? {
              ...prev,
              conversations: prev.conversations.map((c) =>
                c.id === data.branchId
                  ? {
                      ...c,
                      messages: [...c.messages, data.message],
                      ...(sentPin !== undefined ? { pinnedMode: sentPin } : {}),
                    }
                  : c,
              ),
            }
          : prev,
      );
      // A prior failed draft for this branch succeeded now — drop it.
      setFailedDraft((fd) => (fd?.branchId === branchId ? null : fd));
      await loadState();
      return true;
    } catch (err) {
      setError(describe(err));
      // Preserve the draft even if the user has since switched branches (ChatPane unmounted).
      setFailedDraft({ branchId, content });
      return false;
    } finally {
      setSending(false);
    }
  };

  const branch = async (selection: string) => {
    if (!activeId) return;
    setBranching(true);
    try {
      const parent = state?.conversations.find((c) => c.id === activeId);
      const res = await fetch('/api/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentId: activeId,
          selection,
          title: titleFromSelection(selection),
          // A pinned parent hands its pick down: branching off a deliberate choice should
          // not silently fall back to Auto for the branch's first answer.
          mode: (parent && modeFor(parent)) ?? undefined,
        }),
      });
      if (!res.ok) throw new Error(`POST /api/branch → ${res.status}`);
      const data: BranchResponse = await res.json();
      applyState(await fetchState());
      select(data.node.id); // drop the user straight into the new branch
    } catch (err) {
      setError(describe(err));
    } finally {
      setBranching(false);
    }
  };

  /** Distil the branch into one line, fly it to the parent, archive the branch. */
  const merge = async (origin: { x: number; y: number }) => {
    if (!activeId || merging) return;
    setMerging(true);
    try {
      const res = await fetch('/api/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: activeId, archive: true }),
      });
      if (!res.ok) throw new Error(`POST /api/merge → ${res.status}`);
      const data: MergeResponse = await res.json();

      // Measure the target before the refetch reflows anything.
      setFlight({
        id: data.insight.id,
        text: data.insight.text,
        parentId: data.parentId,
        from: origin,
        to: nodeCenter(data.parentId) ?? origin,
      });
      await loadState();
    } catch (err) {
      setError(describe(err));
    } finally {
      setMerging(false);
    }
  };

  /** Pull the Berkeley Clubs example into this session, replacing whatever is here. */
  const loadDemo = async () => {
    try {
      const res = await fetch('/api/demo', { method: 'POST' });
      if (!res.ok) throw new Error(`POST /api/demo → ${res.status}`);
      const data: StateResponse = await res.json();
      setState(data);
      setPendingModes({});
      setFlight(null);
      setMerged(null);
      setActiveId(data.rootId);
      setError(null);
      const logs = await fetchEconomics();
      setEconomics(logs);
    } catch (err) {
      setError(describe(err));
    }
  };

  /** A second tree, not a branch: no parent, no inherited transcript. */
  const newChat = async () => {
    try {
      const res = await fetch('/api/conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`POST /api/conversation → ${res.status}`);
      const data: { node: { id: string } } = await res.json();
      applyState(await fetchState());
      select(data.node.id);
    } catch (err) {
      setError(describe(err));
    }
  };

  // Stable identity: this reaches memoized message bubbles; a fresh closure per render would
  // defeat the memo and re-parse every assistant message's markdown on each keystroke.
  const selectMode = useCallback(
    (mode: ModeSelection | null) => {
      if (!activeId) return;
      setPendingModes((prev) => ({ ...prev, [activeId]: mode }));
    },
    [activeId],
  );

  /**
   * Merging is destructive on purpose — the branch archives and the insight lands on the parent.
   * This puts the tree back so the merge can be shown again, or so a rehearsal doesn't ship its
   * leftovers into the real run. Unsent mode picks go too: they belong to the run being discarded.
   */
  const reset = async () => {
    try {
      const res = await fetch('/api/reset', { method: 'POST' });
      if (!res.ok) throw new Error(`POST /api/reset → ${res.status}`);
      const data: StateResponse = await res.json();
      setState(data);
      setPendingModes({});
      setFlight(null);
      setMerged(null);
      setEconomicsOpen(false);
      setActiveId(data.rootId);
      setError(null);
      const logs = await fetchEconomics();
      setEconomics(logs);
    } catch (err) {
      setError(describe(err));
    }
  };

  if (error && !state) {
    return (
      <main className="flex flex-1 items-center justify-center bg-paper p-8">
        <div className="max-w-md text-center">
          <p className="eyebrow">the garden</p>
          <h1 className="font-display text-4xl text-ink">Bonsai</h1>
          <p className="mt-3 text-sm text-ink-soft">
            The garden is here, but the roots aren&apos;t drawing water yet — the engine didn&apos;t
            answer.
          </p>
          <p className="tnum mt-2 text-xs text-bark">{error}</p>
          <button
            onClick={loadState}
            className="mt-5 rounded-md border border-moss px-4 py-1.5 text-xs font-medium text-moss transition-colors hover:bg-moss-wash"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="flex flex-1 items-center justify-center bg-paper">
        <p className="text-sm text-ink-soft">
          <span className="font-display text-lg text-ink">Bonsai</span>
          <span className="mx-2 text-bark">·</span>
          unfurling the garden…
        </p>
      </main>
    );
  }

  const active =
    state.conversations.find((c) => c.id === activeId) ??
    state.conversations.find((c) => c.id === state.rootId) ??
    state.conversations[0];

  const branchTitles = Object.fromEntries(state.conversations.map((c) => [c.id, c.title]));

  // Per-branch spend, summed over every inference the engine logged against that branch.
  const costByBranch = new Map<string, number>();
  for (const log of economics?.logs ?? []) {
    costByBranch.set(log.branchId, (costByBranch.get(log.branchId) ?? 0) + log.estCostUsd);
  }

  // An insight is stored on the parent it landed on, so count them back onto their source.
  const mergedByBranch = new Map<string, number>();
  for (const conversation of state.conversations) {
    for (const insight of conversation.insights) {
      mergedByBranch.set(insight.branchId, (mergedByBranch.get(insight.branchId) ?? 0) + 1);
    }
  }

  const nodeStats: Record<string, NodeStats> = Object.fromEntries(
    state.conversations.map((c) => {
      // BranchNode carries only the engine-internal tier, so the card's model and effort come
      // from the last answer's own routing decision.
      const lastRouting = [...c.messages].reverse().find((m) => m.routing)?.routing ?? null;
      return [
        c.id,
        {
          // Same formula as the chat header (ChatPane) so the card and the header agree.
          contextTokens: conversationTokens(c.messages) + (c.brief?.briefTokens ?? 0),
          costUsd: costByBranch.get(c.id) ?? null,
          mergedInsights: mergedByBranch.get(c.id) ?? 0,
          modelLabel: lastRouting?.modelLabel ?? lastRouting?.model ?? null,
          effort: lastRouting?.effort ?? null,
        },
      ];
    }),
  );

  return (
    <main className="relative flex min-h-0 flex-1">
      {/*
        Failures after first load (send, branch, merge, reset) surface here. An overlay rather
        than a swap: the workspace stays interactive underneath, nothing blanks. A later
        successful refetch clears it via applyState; the button clears it by hand.
      */}
      {error && (
        <div
          role="alert"
          className="absolute left-1/2 top-4 z-50 flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-lg border border-[color:var(--ember)]/40 bg-paper-raised px-4 py-2.5 shadow-sm"
        >
          <p className="text-xs leading-snug text-ember">{error}</p>
          <button
            onClick={() => setError(null)}
            className="shrink-0 rounded border border-rule-strong px-2 py-0.5 text-[11px] text-ink-soft transition-colors hover:bg-paper-sunk hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}
      <TreeSidebar
        nodes={state.tree}
        activeId={active?.id ?? null}
        onSelect={select}
        onOpenEconomics={() => setEconomicsOpen(true)}
        onReset={reset}
        onNewChat={newChat}
        onLoadDemo={loadDemo}
        flashId={merged?.parentId ?? null}
        stats={nodeStats}
        session={
          // Before the first inference the totals are all zero — show the label, not "$0.0000".
          economics && economics.totals.inferenceCount > 0
            ? {
                costUsd: economics.totals.costUsd,
                inputTokens: economics.totals.inputTokens,
              }
            : null
        }
      />
      {active ? (
        <ChatPane
          // Remount per conversation so draft + text selection reset with the branch.
          key={active.id}
          conversation={active}
          onSend={send}
          onBranch={branch}
          onSelectMode={selectMode}
          onMerge={merge}
          mode={modeFor(active)}
          sending={sending}
          branching={branching}
          merging={merging}
          highlightInsightId={
            merged && merged.parentId === active.id ? merged.insightId : null
          }
          initialDraft={failedDraft?.branchId === active.id ? failedDraft.content : undefined}
          onDraftRestored={() => setFailedDraft(null)}
        />
      ) : (
        <section className="flex flex-1 items-center justify-center bg-paper">
          <p className="text-sm text-ink-soft">Pick a branch from the garden.</p>
        </section>
      )}

      {flight && (
        <MergeFlight
          key={flight.id}
          flight={flight}
          onDone={() => {
            setFlight(null);
            // Land on the parent so the merged line is on screen when the pill lands.
            select(flight.parentId);
            setMerged({ parentId: flight.parentId, insightId: flight.id });
          }}
        />
      )}

      {economicsOpen && (
        <EconomicsPanel
          branchTitles={branchTitles}
          onClose={() => setEconomicsOpen(false)}
        />
      )}
    </main>
  );
}
