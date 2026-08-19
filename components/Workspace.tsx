'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BranchResponse,
  ChatResponse,
  Conversation,
  EconomicsResponse,
  MergeResponse,
  ModeSelection,
  StateResponse,
} from '@/lib/types';
import { BriefSheet } from './BriefSheet';
import { ChatPane } from './ChatPane';
import { CommandPalette } from './CommandPalette';
import { EconomicsPanel } from './EconomicsPanel';
import { MergeFlight, type Flight } from './MergeFlight';
import { TourBanner, type TourStep } from './Tour';
import { TreeSidebar, type NodeStats } from './TreeSidebar';
import { conversationTokens } from './tokens';
import { createSseParser } from '@/lib/sse';

/**
 * The API writes human-readable error bodies ("state not persisted — database write failed",
 * zod field issues) — surface those, not `POST /api/x → 400`. Falls back to the status line
 * when the body isn't the ApiError shape.
 */
async function httpError(res: Response, label: string): Promise<Error> {
  const fallback = `${label} → ${res.status}`;
  try {
    const body = (await res.json()) as { error?: unknown };
    return new Error(typeof body.error === 'string' && body.error ? body.error : fallback);
  } catch {
    return new Error(fallback);
  }
}

/** Pure fetch — returns data, touches no state, so effects can own their own setState. */
async function fetchState(): Promise<StateResponse> {
  const res = await fetch('/api/state');
  if (!res.ok) throw await httpError(res, 'GET /api/state');
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
  /** Informational banner (moss, not ember) — e.g. merge-staleness disclosure. Auto-dismisses. */
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [branching, setBranching] = useState(false);
  /*
   * The server owns pins now (Conversation.pinnedMode). This map holds only the picks made
   * since a branch's last send — each is sent once on the next message, then dropped in favour
   * of the refetched pinnedMode. null means an explicit switch back to Auto, which unpins.
   */
  const [pendingModes, setPendingModes] = useState<Record<string, ModeSelection | null>>({});
  const [merging, setMerging] = useState(false);
  /** The in-flight answer, streamed token by token. Null when nothing is streaming. */
  const [stream, setStream] = useState<{ branchId: string; text: string } | null>(null);
  /** A draft from a send that failed while its branch was unmounted — handed back on remount. */
  const [failedDraft, setFailedDraft] = useState<{ branchId: string; content: string } | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  /** The insight that just landed, so the parent node and the line itself can glow. */
  const [merged, setMerged] = useState<{ parentId: string; insightId: string } | null>(null);
  const [economicsOpen, setEconomicsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** The guided first-session loop. Null = not touring. Persisted off in localStorage on finish. */
  const [tourStep, setTourStep] = useState<TourStep | null>(null);
  /** Selection awaiting the brief-preview sheet; the fork ships from there. */
  const [briefSheet, setBriefSheet] = useState<{ parentId: string; selection: string } | null>(null);
  const [demoMode, setDemoMode] = useState(false);

  // Honesty ribbon: without a provider key the answers come from the extractive mock. Say so —
  // a stranger reading mock output as a real model's is worse than a smaller-looking demo.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/modes')
      .then((res) => (res.ok ? res.json() : null))
      .then((modes: { provider?: string } | null) => {
        if (!cancelled && modes?.provider === 'mock') setDemoMode(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // ⌘K / Ctrl-K from anywhere in the workspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!merged) return;
    const timer = setTimeout(() => setMerged(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [merged]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(timer);
  }, [notice]);

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

  /**
   * POST to a streaming twin endpoint and consume its SSE into the shared stream state;
   * falls back to the buffered endpoint when the response isn't a stream. Both chat and
   * message-replay speak the same protocol (lib/sse-turn).
   */
  const streamTurn = async (
    streamPath: string,
    bufferedPath: string,
    branchId: string,
    payload: string,
  ): Promise<ChatResponse> => {
    const post = (path: string) =>
      fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
    const res = await post(streamPath);
    if (!res.ok) throw await httpError(res, `POST ${streamPath}`);
    const isSse = (res.headers.get('content-type') ?? '').includes('text/event-stream');
    if (!res.body || !isSse) {
      const buffered = await post(bufferedPath);
      if (!buffered.ok) throw await httpError(buffered, `POST ${bufferedPath}`);
      return buffered.json();
    }
    setStream({ branchId, text: '' });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parse = createSseParser();
    let final: ChatResponse | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      const chunk = value ? decoder.decode(value, { stream: !done }) : '';
      for (const ev of parse(chunk)) {
        if (ev.event === 'delta') {
          const { text } = JSON.parse(ev.data) as { text: string };
          setStream((prev) =>
            prev && prev.branchId === branchId
              ? { branchId, text: prev.text + text }
              : { branchId, text },
          );
        } else if (ev.event === 'restart') {
          // The ladder discarded the partial answer (widened or escalated) — start over.
          setStream({ branchId, text: '' });
        } else if (ev.event === 'done') {
          final = JSON.parse(ev.data) as ChatResponse;
        } else if (ev.event === 'error') {
          throw new Error((JSON.parse(ev.data) as { error: string }).error);
        }
      }
      if (done) break;
    }
    if (!final) throw new Error('stream ended without a result');
    return final;
  };

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
      const payload = JSON.stringify({
        branchId,
        content,
        mode: hadPending ? (pending ?? { mode: 'auto' as const }) : undefined,
      });
      const data = await streamTurn('/api/chat/stream', '/api/chat', branchId, payload);

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
      setStream(null);
      setSending(false);
    }
  };

  /** Selection → the brief-preview sheet. The fork itself ships from growBranch below. */
  const branch = (selection: string) => {
    if (!activeId) return;
    setBriefSheet({ parentId: activeId, selection });
  };

  const growBranch = async (facts: string[], question: string) => {
    if (!briefSheet) return;
    setBranching(true);
    try {
      const parent = state?.conversations.find((c) => c.id === briefSheet.parentId);
      const res = await fetch('/api/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentId: briefSheet.parentId,
          selection: briefSheet.selection,
          title: titleFromSelection(briefSheet.selection),
          facts,
          ...(question ? { question } : {}),
          // A pinned parent hands its pick down: branching off a deliberate choice should
          // not silently fall back to Auto for the branch's first answer.
          mode: (parent && modeFor(parent)) ?? undefined,
        }),
      });
      if (!res.ok) throw await httpError(res, 'POST /api/branch');
      const data: BranchResponse = await res.json();
      setBriefSheet(null);
      applyState(await fetchState());
      select(data.node.id); // drop the user straight into the new branch
      if (tourStep === 'branch') setTourStep('merge');
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
      if (!res.ok) throw await httpError(res, 'POST /api/merge');
      const data: MergeResponse = await res.json();
      if (data.parentDriftTurns) {
        setNotice(
          `The trunk grew ${data.parentDriftTurns} turn${data.parentDriftTurns === 1 ? '' : 's'} since this fork — the merged insight predates them. Reground with a fresh branch if it depended on the new turns.`,
        );
      }

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

  /** Shared by regenerate and edit — both replay a turn through the /api/message pair. */
  const messageAction = async (payload: {
    messageId: string;
    op: 'regenerate' | 'edit';
    content?: string;
  }): Promise<boolean> => {
    if (!activeId || sending) return false;
    const branchId = activeId;
    setSending(true);
    // Optimistic truncation so the discarded turns leave the screen while the replacement
    // streams into their place; loadState() reconciles with what the server actually stored
    // (including on failure, where it restores the untouched thread).
    setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        conversations: prev.conversations.map((c) => {
          if (c.id !== branchId) return c;
          const idx = c.messages.findIndex((m) => m.id === payload.messageId);
          if (idx === -1) return c;
          // Regenerate targets the assistant message: keep everything before it (the question
          // stays on screen). Edit targets the user message: swap in the new text. Either way
          // everything after the rerun point leaves so the stream renders in its place.
          const kept = c.messages.slice(0, idx);
          const messages =
            payload.op === 'edit'
              ? [
                  ...kept,
                  { id: 'optimistic-edit', role: 'user' as const, content: payload.content ?? '' },
                ]
              : kept;
          return { ...c, messages };
        }),
      };
    });
    try {
      await streamTurn(
        '/api/message/stream',
        '/api/message',
        branchId,
        JSON.stringify({ branchId, ...payload }),
      );
      await loadState();
      return true;
    } catch (err) {
      setError(describe(err));
      await loadState(); // put the truncated-away turns back on screen
      return false;
    } finally {
      setStream(null);
      setSending(false);
    }
  };

  const regenerate = (messageId: string) =>
    messageAction({ messageId, op: 'regenerate' });
  const editMessage = (messageId: string, content: string) =>
    messageAction({ messageId, op: 'edit', content });

  const nodeActionInFlight = useRef(false);
  const nodeAction = async (payload: {
    id: string;
    op: 'rename' | 'archive' | 'unarchive';
    title?: string;
  }): Promise<void> => {
    if (nodeActionInFlight.current) return;
    nodeActionInFlight.current = true;
    try {
      const res = await fetch('/api/node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await httpError(res, 'POST /api/node');
      await loadState();
    } catch (err) {
      setError(describe(err));
    } finally {
      nodeActionInFlight.current = false;
    }
  };

  /** A sentence from the demo trunk worth branching on — picked live so the tour never stales. */
  const tourSelection = (): { parentId: string; selection: string } | null => {
    if (!state) return null;
    const root = state.conversations.find((c) => c.id === state.rootId);
    const lastAnswer = root ? [...root.messages].reverse().find((m) => m.role === 'assistant') : null;
    if (!root || !lastAnswer) return null;
    const sentence =
      lastAnswer.content
        .replace(/[*_`#>]/g, '')
        .split(/(?<=[.!?])\s+/)
        .find((s) => s.trim().length > 60) ?? lastAnswer.content.slice(0, 120);
    return { parentId: root.id, selection: sentence.trim().slice(0, 300) };
  };

  const startTour = async () => {
    await loadDemo();
    setTourStep('branch');
  };

  const endTour = () => {
    setTourStep(null);
    try {
      localStorage.setItem('bonsai:toured', '1');
    } catch {}
  };

  const tourAction = async () => {
    if (tourStep === 'branch') {
      const pick = tourSelection();
      if (!pick) return endTour();
      select(pick.parentId);
      setBriefSheet(pick); // growing from the sheet advances the tour below
    } else if (tourStep === 'merge') {
      await merge({ x: window.innerWidth / 2, y: 80 });
      setTourStep('receipt');
    } else if (tourStep === 'receipt') {
      setEconomicsOpen(true);
      endTour();
    }
  };

  /** Pull the Berkeley Clubs example into this session, replacing whatever is here. */
  const loadDemo = async () => {
    try {
      const res = await fetch('/api/demo', { method: 'POST' });
      if (!res.ok) throw await httpError(res, 'POST /api/demo');
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
      if (!res.ok) throw await httpError(res, 'POST /api/conversation');
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
      if (!res.ok) throw await httpError(res, 'POST /api/reset');
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
    <main className="relative flex min-h-0 flex-1 flex-col md:flex-row">
      {/*
        Failures after first load (send, branch, merge, reset) surface here. An overlay rather
        than a swap: the workspace stays interactive underneath, nothing blanks. A later
        successful refetch clears it via applyState; the button clears it by hand.
      */}
      {notice && (
        <div
          role="status"
          className="absolute left-1/2 top-4 z-50 flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-lg border border-moss/40 bg-paper-raised px-4 py-2.5 shadow-sm"
        >
          <p className="text-xs leading-snug text-moss">{notice}</p>
          <button
            onClick={() => setNotice(null)}
            className="shrink-0 rounded border border-rule-strong px-2 py-0.5 text-[11px] text-ink-soft transition-colors hover:bg-paper-sunk hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}
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
          onRegenerate={regenerate}
          onEditMessage={editMessage}
          onRename={(title) => nodeAction({ id: active.id, op: 'rename', title })}
          onOpenBranch={select}
          branchTitles={branchTitles}
          onArchive={
            active.parentId
              ? (archived) =>
                  nodeAction({ id: active.id, op: archived ? 'archive' : 'unarchive' })
              : undefined
          }
          mode={modeFor(active)}
          sending={sending}
          streamingText={stream?.branchId === active.id ? stream.text : null}
          branching={branching}
          merging={merging}
          highlightInsightId={
            merged && merged.parentId === active.id ? merged.insightId : null
          }
          initialDraft={failedDraft?.branchId === active.id ? failedDraft.content : undefined}
          onDraftRestored={() => setFailedDraft(null)}
          onLoadDemo={loadDemo}
          onStartTour={startTour}
        />
      ) : (
        <section className="flex flex-1 items-center justify-center bg-paper">
          <p className="text-sm text-ink-soft">Pick a branch from the garden.</p>
        </section>
      )}

      {demoMode && (
        <p className="pointer-events-none absolute bottom-3 left-1/2 z-40 max-w-[92vw] -translate-x-1/2 rounded-full border border-rule bg-paper-raised px-3 py-1 text-center text-[10px] text-bark shadow-sm">
          demo mode · answers are an extractive mock — briefs, routing, and pruning are real
        </p>
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

      {briefSheet && (
        <BriefSheet
          parentId={briefSheet.parentId}
          selection={briefSheet.selection}
          defaultQuestion={
            tourStep === 'branch'
              ? 'What is the single most important thing to know about this?'
              : undefined
          }
          onGrow={growBranch}
          onClose={() => {
            setBriefSheet(null);
            if (tourStep === 'branch') endTour();
          }}
          growing={branching}
        />
      )}

      {tourStep && !briefSheet && (
        <TourBanner
          step={tourStep}
          busy={branching || merging || sending}
          onAction={() => void tourAction()}
          onSkip={endTour}
        />
      )}

      {paletteOpen && state && (
        <CommandPalette
          conversations={state.conversations}
          onSelectBranch={select}
          onNewChat={newChat}
          onOpenEconomics={() => setEconomicsOpen(true)}
          onExport={(format, scope) => {
            const params = new URLSearchParams({ format });
            if (scope === 'branch' && active) params.set('branch', active.id);
            // An anchor click, not a navigation: Content-Disposition makes it a download and
            // the page stays put (router.push would be wrong — this is a file, not a page).
            const a = document.createElement('a');
            a.href = `/api/export?${params}`;
            a.download = '';
            document.body.appendChild(a);
            a.click();
            a.remove();
          }}
          activeIsBranch={Boolean(active?.parentId)}
          onClose={() => setPaletteOpen(false)}
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
