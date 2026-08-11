'use client';

import { useEffect, useRef, useState } from 'react';
import type { Conversation, FactProvenanceStatus, ModeSelection } from '@/lib/types';
import { RoutingChip } from './RoutingChip';
import { conversationTokens, formatTokens } from './tokens';

type Selection = { text: string; x: number; y: number };

const PROVENANCE_LABEL: Record<FactProvenanceStatus, string> = {
  'model-cited': 'source ID cited; entailment unchecked',
  extractive: 'exact extract',
  'legacy-unknown': 'legacy provenance unknown',
};

export function ChatPane({
  conversation,
  onSend,
  onBranch,
  onSelectMode,
  onMerge,
  mode,
  sending,
  branching,
  merging,
  highlightInsightId,
}: {
  conversation: Conversation;
  onSend: (content: string) => void;
  onBranch: (selection: string) => void;
  onSelectMode: (mode: ModeSelection | null) => void;
  /** Takes the button's viewport centre so the merge animation starts where it was clicked. */
  onMerge: (origin: { x: number; y: number }) => void;
  mode: ModeSelection | null;
  sending: boolean;
  branching: boolean;
  merging: boolean;
  highlightInsightId: string | null;
}) {
  const [draft, setDraft] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [conversation.messages.length, conversation.id]);

  const brief = conversation.brief;
  // A branch's context is its compiled brief plus whatever has been said since — not just
  // the messages. Without the brief a fresh branch reads "0 context tokens" while the header
  // right above it says "466 relevant", which is two numbers for the same thing.
  const tokens = conversationTokens(conversation.messages) + (brief?.briefTokens ?? 0);

  /**
   * Recomputes the floating Branch button's anchor from the live selection.
   *
   * Also runs on scroll, and that is load-bearing: dragging a selection near the bottom edge
   * auto-scrolls the container, and clearing the selection on scroll instead of re-anchoring
   * it made the Branch button silently never appear — which is Beats 2 and 3.
   */
  const captureSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!sel || sel.isCollapsed || !text) {
      setSelection(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const bounds = scrollRef.current?.getBoundingClientRect();
    // Selection scrolled out of the chat area — drop the button rather than float it loose.
    if (bounds && (rect.bottom < bounds.top || rect.top > bounds.bottom)) {
      setSelection(null);
      return;
    }
    setSelection({ text, x: rect.left + rect.width / 2, y: rect.top });
  };

  const submit = () => {
    const content = draft.trim();
    if (!content || sending) return;
    onSend(content);
    setDraft('');
  };

  return (
    <section className="relative flex min-w-0 flex-1 flex-col bg-neutral-900">
      <header className="flex items-center gap-3 border-b border-white/10 px-6 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-white">
            {conversation.title}
          </h2>
          {brief ? (
            // DEMO.md Beat 2 reads this line off the screen.
            <p className="truncate text-[11px] tabular-nums text-neutral-500">
              <span className="text-neutral-400">{brief.availableTokens.toLocaleString()}</span>{' '}
              available →{' '}
              <span className="text-neutral-400">{brief.briefTokens.toLocaleString()}</span>{' '}
              relevant →{' '}
              <span className="font-medium text-emerald-300">
                {brief.prunedPct.toFixed(1)}% pruned
              </span>
            </p>
          ) : (
            <p className="text-[11px] text-neutral-500">
              Root conversation · select any text to branch
            </p>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-4">
          {/* Merge insight — DEMO.md Beat 4. Only branches have a parent to merge into. */}
          {conversation.parentId &&
            (conversation.archived ? (
              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-200">
                Merged · archived
              </span>
            ) : (
              <button
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  onMerge({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                }}
                disabled={merging || conversation.messages.length === 0}
                className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-400/20 disabled:opacity-40"
              >
                {merging ? 'Distilling…' : 'Merge insight'}
              </button>
            ))}

          {/* Running input-token counter — DEMO.md Beat 1 points straight at this. */}
          <div className="text-right">
            <div className="font-mono text-lg leading-none tabular-nums text-white">
              {formatTokens(tokens)}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              context tokens
            </div>
          </div>
        </div>
      </header>

      {/*
        Merged insights live outside the scroll area on purpose: the root is 72 messages
        deep, and DEMO.md Beat 4 has to show the distilled line landing without scrolling.
      */}
      {conversation.insights.length > 0 && (
        <div className="max-h-32 shrink-0 overflow-y-auto border-b border-emerald-400/20 bg-emerald-400/[0.06] px-6 py-2.5">
          <div className="mx-auto max-w-3xl">
            <div className="text-[10px] uppercase tracking-wide text-emerald-300/70">
              Merged insights · {conversation.insights.length}
            </div>
            {conversation.insights.map((insight) => (
              <p
                key={insight.id}
                // The freshly landed insight glows for a beat so the merge reads on a projector.
                className={`-mx-1 mt-1 rounded px-1 py-0.5 text-xs text-emerald-100 ring-1 transition-all duration-700 ${
                  insight.id === highlightInsightId
                    ? 'bg-emerald-400/20 ring-emerald-300/60'
                    : 'ring-transparent'
                }`}
              >
                {insight.text}
              </p>
            ))}
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        onMouseUp={captureSelection}
        onScroll={captureSelection}
        className="flex-1 overflow-y-auto px-6 py-4"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {brief && (
            <details className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <summary className="cursor-pointer text-[11px] text-neutral-400">
                Compiled context brief · {brief.facts.length} facts
              </summary>
              <ul className="mt-2 flex flex-col gap-1">
                {brief.facts.map((fact, index) => (
                  <li key={`${fact}:${index}`} className="text-[11px] leading-snug text-neutral-300">
                    · {fact}{' '}
                    <span className="text-[10px] text-neutral-600">
                      ({PROVENANCE_LABEL[brief.factProvenance[index] ?? 'legacy-unknown']})
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 border-t border-white/10 pt-2 text-[11px] leading-snug text-neutral-500">
                {brief.excludedNote}
              </p>
            </details>
          )}

          {conversation.messages.map((message) => (
            <div
              key={message.id}
              className={
                message.role === 'user' ? 'flex justify-end' : 'flex justify-start'
              }
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  message.role === 'user'
                    ? 'bg-white/10 text-white'
                    : 'bg-white/[0.04] text-neutral-200'
                }`}
              >
                {message.content}
                {message.routing && (
                  <span className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2">
                    <RoutingChip
                      routing={message.routing}
                      mode={mode}
                      onSelectMode={onSelectMode}
                    />
                  </span>
                )}
              </div>
            </div>
          ))}

          {branching && (
            <div className="text-xs text-emerald-300">Compiling branch context…</div>
          )}
          {sending && <div className="text-xs text-neutral-500">Thinking…</div>}
        </div>
      </div>

      {/* Floating Branch affordance — DEMO.md Beat 2: highlight, then click Branch. */}
      {selection && (
        <button
          onClick={() => {
            onBranch(selection.text);
            setSelection(null);
            window.getSelection()?.removeAllRanges();
          }}
          style={{ left: selection.x, top: selection.y - 10 }}
          className="fixed z-40 -translate-x-1/2 -translate-y-full rounded-lg border border-black/70 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-black/40 hover:bg-emerald-500"
        >
          Branch
        </button>
      )}

      <footer className="border-t border-white/10 px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Ask something…"
            className="max-h-40 min-h-[38px] flex-1 resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-white/20 focus:outline-none"
          />
          <button
            onClick={submit}
            disabled={sending || !draft.trim()}
            className="h-[38px] shrink-0 rounded-lg bg-white px-4 text-sm font-medium text-neutral-900 transition-opacity disabled:opacity-30"
          >
            Send
          </button>
        </div>
        {mode?.mode === 'manual' && (
          <p className="mx-auto mt-1.5 max-w-3xl text-[10px] text-neutral-500">
            Branch pinned — classification skipped on every message here.
          </p>
        )}
      </footer>
    </section>
  );
}
