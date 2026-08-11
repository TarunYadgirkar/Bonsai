'use client';

import { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Conversation, Message, ModeSelection } from '@/lib/types';
import { RoutingChip } from './RoutingChip';
import { conversationTokens, formatTokens } from './tokens';

type Selection = { text: string; x: number; y: number };

/**
 * Memoized so composer keystrokes and selection updates don't re-parse every assistant
 * message's markdown — the thread re-renders per keystroke, the bubbles shouldn't.
 */
const MessageBubble = memo(function MessageBubble({
  message,
  mode,
  onSelectMode,
}: {
  message: Message;
  mode: ModeSelection | null;
  onSelectMode: (mode: ModeSelection | null) => void;
}) {
  return (
    <div className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed text-ink ${
          message.role === 'user'
            ? 'whitespace-pre-wrap bg-moss-wash'
            : 'border border-rule bg-paper-raised'
        }`}
      >
        {message.role === 'user' ? (
          message.content
        ) : (
          // Assistant turns are markdown. react-markdown escapes raw HTML by default —
          // no rehype-raw, on purpose. User turns stay plain text above.
          <div className="[&>*+*]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li+li]:mt-1 [&_strong]:font-semibold [&_strong]:text-ink [&_a]:text-moss [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-rule [&_blockquote]:pl-3 [&_blockquote]:text-ink-soft [&_:is(h1,h2,h3,h4)]:font-display [&_:is(h1,h2,h3,h4)]:font-semibold [&_:is(h1,h2,h3,h4)]:text-ink [&_code]:rounded [&_code]:bg-paper-sunk [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-ink [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-rule [&_pre]:bg-paper-sunk [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
        {message.routing && (
          <span className="mt-2 flex items-center gap-2 border-t border-rule pt-2">
            <RoutingChip routing={message.routing} mode={mode} onSelectMode={onSelectMode} />
          </span>
        )}
      </div>
    </div>
  );
});

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
  initialDraft,
  onDraftRestored,
}: {
  conversation: Conversation;
  /** Resolves false when the send failed, so the composer can restore the draft. */
  onSend: (content: string) => Promise<boolean>;
  onBranch: (selection: string) => void;
  onSelectMode: (mode: ModeSelection | null) => void;
  /** Takes the button's viewport centre so the merge animation starts where it was clicked. */
  onMerge: (origin: { x: number; y: number }) => void;
  mode: ModeSelection | null;
  sending: boolean;
  branching: boolean;
  merging: boolean;
  highlightInsightId: string | null;
  /** A draft recovered from a send that failed while this branch was unmounted (branch switch). */
  initialDraft?: string;
  /** Called once this branch's recovered draft has been seeded, so the parent can drop it. */
  onDraftRestored?: () => void;
}) {
  // Seed from a recovered failed-send draft: ChatPane remounts per branch, so a plain local
  // restore is lost if the user switched branches mid-send. The parent hands it back here.
  const [draft, setDraft] = useState(initialDraft ?? '');
  const [selection, setSelection] = useState<Selection | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialDraft) onDraftRestored?.();
    // Mount-only: initialDraft is a one-shot hand-off consumed when this branch mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
   * it made the Branch button silently never appear — killing selection-to-branch.
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

  const submit = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setDraft('');
    const sent = await onSend(content);
    // Failed send: put the text back rather than destroy it — unless the user already
    // started typing something new while the request was in flight.
    if (!sent) setDraft((current) => current || content);
  };

  return (
    <section className="relative flex min-w-0 flex-1 flex-col bg-paper">
      <header className="flex items-center gap-3 border-b border-rule px-6 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-display text-base text-ink">
            {conversation.title}
          </h2>
          {brief ? (
            <p className="truncate text-[11px] text-bark">
              <span className="tnum text-ink-soft">{brief.availableTokens.toLocaleString()}</span>{' '}
              available <span className="tnum text-bark">→</span>{' '}
              <span className="tnum text-ink-soft">{brief.briefTokens.toLocaleString()}</span>{' '}
              relevant <span className="tnum text-bark">→</span>{' '}
              <span className="tnum text-moss">{brief.prunedPct.toFixed(1)}%</span> pruned
            </p>
          ) : (
            <p className="text-[11px] text-bark">
              Root conversation · select any text to branch
            </p>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-4">
          {/* Merge insight — only branches have a parent to merge into. */}
          {conversation.parentId &&
            (conversation.archived ? (
              <span className="rounded-full border border-moss/30 bg-moss-wash px-2.5 py-1 text-[11px] text-moss">
                Merged · archived
              </span>
            ) : (
              <button
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  onMerge({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                }}
                disabled={merging || conversation.messages.length === 0}
                className="rounded-full border border-moss/40 bg-moss-wash px-3 py-1.5 text-xs font-medium text-moss transition-colors hover:bg-moss/15 disabled:opacity-40"
              >
                {merging ? 'Distilling…' : 'Merge insight'}
              </button>
            ))}

          <div className="text-right">
            <div className="tnum text-lg leading-none text-ink">
              {formatTokens(tokens)}
            </div>
            <div className="eyebrow mt-0.5">context tokens</div>
          </div>
        </div>
      </header>

      {/*
        Merged insights live outside the scroll area on purpose: the thread can be dozens of
        messages deep, and a landing insight must be visible without scrolling. These lines
        genuinely enter the model's context on every turn here, so showing them is truth.
        Collapsible like the brief disclosure below; open by default so a fresh merge glows —
        the per-branch remount reopens it on every branch switch. A pressed botanical note.
      */}
      {conversation.insights.length > 0 && (
        <details
          open
          className="max-h-40 shrink-0 overflow-y-auto border-b border-rule bg-paper-sunk px-6 py-2.5"
        >
          <summary className="mx-auto max-w-3xl cursor-pointer eyebrow">
            learned from branches · {conversation.insights.length}
          </summary>
          <div className="mx-auto max-w-3xl">
            {conversation.insights.map((insight) => (
              <p
                key={insight.id}
                // The freshly landed insight glows for a beat so the merge reads on a projector.
                className={`-mx-1 mt-1 rounded px-1.5 py-1 text-xs leading-relaxed text-ink ring-1 transition-all duration-700 ${
                  insight.id === highlightInsightId
                    ? 'bg-moss-wash ring-moss/50'
                    : 'ring-transparent'
                }`}
              >
                {insight.text}
              </p>
            ))}
          </div>
        </details>
      )}

      <div
        ref={scrollRef}
        onMouseUp={captureSelection}
        onScroll={captureSelection}
        className="flex-1 overflow-y-auto px-6 py-4"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {brief && (
            <details className="rounded-lg border border-rule bg-paper-sunk px-3 py-2">
              <summary className="cursor-pointer eyebrow">
                compiled context brief · {brief.facts.length} facts
              </summary>
              <ul className="mt-2 flex flex-col gap-1">
                {brief.facts.map((fact) => (
                  <li key={fact} className="text-[11px] leading-relaxed text-ink-soft">
                    · {fact}
                  </li>
                ))}
              </ul>
              <p className="mt-2 border-t border-rule pt-2 text-[11px] leading-relaxed text-bark">
                {brief.excludedNote}
              </p>
            </details>
          )}

          {conversation.messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              mode={mode}
              onSelectMode={onSelectMode}
            />
          ))}

          {branching && (
            <div className="text-xs text-moss">Compiling branch context…</div>
          )}
          {sending && <div className="text-xs text-bark">Thinking…</div>}
        </div>
      </div>

      {/* Floating Branch affordance: highlight text in the thread, then click Branch. */}
      {selection && (
        <button
          onClick={() => {
            onBranch(selection.text);
            setSelection(null);
            window.getSelection()?.removeAllRanges();
          }}
          style={{ left: selection.x, top: selection.y - 10 }}
          className="fixed z-40 inline-flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-full border border-moss-bright bg-moss px-3 py-1.5 text-xs font-semibold text-paper shadow-sm transition-colors hover:bg-moss-bright"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden
          >
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
            <path d="M2 21c0-3 1.85-5.36 5.08-6" />
          </svg>
          Branch
        </button>
      )}

      <footer className="border-t border-rule px-6 py-3">
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
            className="max-h-40 min-h-[38px] flex-1 resize-none rounded-lg border border-rule bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-bark focus:border-moss focus:outline-none"
          />
          <button
            onClick={submit}
            disabled={sending || !draft.trim()}
            className="h-[38px] shrink-0 rounded-lg bg-moss px-4 text-sm font-medium text-paper transition-colors hover:bg-moss-bright disabled:opacity-30"
          >
            Send
          </button>
        </div>
        {mode?.mode === 'manual' && (
          <p className="mx-auto mt-1.5 max-w-3xl text-[10px] text-bark">
            Branch pinned — classification skipped on every message here.
          </p>
        )}
      </footer>
    </section>
  );
}
