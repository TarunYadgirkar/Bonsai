'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Archive,
  ArrowBendLeftUp,
  ArrowUp,
  GitFork,
  GitMerge,
  Sparkle,
} from '@phosphor-icons/react';
import { parseTurnCommand, type TurnCommand } from 'bonsai-engine';
import type { ContextBrief, Conversation, Insight, Message, ModeSelection } from '@/lib/types';
import { CutStrip, plainFact } from './CutStrip';
import { RoutingChip } from './RoutingChip';
import { conversationTokens, formatTokens } from './tokens';

type Selection = { text: string; x: number; y: number };

/** Half the floating Branch button's width plus a margin, for clamping it to the viewport. */
const BRANCH_BUTTON_HALF = 84;

/** done: the command ran. failed: it ran and failed, keep the draft. unhandled: send it as text. */
export type CommandOutcome = 'done' | 'failed' | 'unhandled';

/** Assistant-markdown styling, shared by settled bubbles and the streaming one. */
const MARKDOWN_CLASSES =
  '[&>*+*]:mt-2.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li+li]:mt-1 [&_strong]:font-semibold [&_strong]:text-ink [&_a]:text-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-rule-strong [&_blockquote]:pl-3 [&_blockquote]:text-ink-muted [&_:is(h1,h2,h3,h4)]:font-display [&_:is(h1,h2,h3,h4)]:font-semibold [&_:is(h1,h2,h3,h4)]:text-ink [&_code]:rounded [&_code]:bg-surface-sunk [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-ink [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-surface-sunk [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0';

/**
 * Memoized so composer keystrokes and selection updates don't re-parse every assistant
 * message's markdown — the thread re-renders per keystroke, the bubbles shouldn't.
 */
const MessageBubble = memo(function MessageBubble({
  message,
  mode,
  onSelectMode,
  onRegenerate,
  onStartEdit,
  busy,
}: {
  message: Message;
  mode: ModeSelection | null;
  onSelectMode: (mode: ModeSelection | null) => void;
  /** Present only on the last assistant message — regenerating earlier ones would drop history. */
  onRegenerate?: () => void;
  /** Present only on the last user message, for the same reason. */
  onStartEdit?: () => void;
  busy: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <div
      className={`group ${message.role === 'user' ? 'flex flex-col items-end' : 'flex flex-col items-start'}`}
    >
      <div
        className={`max-w-[min(85%,68ch)] rounded-[var(--radius-bud)] px-4 py-3 text-[15px] leading-relaxed text-ink ${
          message.role === 'user'
            ? 'whitespace-pre-wrap bg-accent-wash'
            : 'bg-surface-raised shadow-bud'
        }`}
      >
        {message.role === 'user' ? (
          message.content
        ) : (
          // Assistant turns are markdown. react-markdown escapes raw HTML by default —
          // no rehype-raw, on purpose. User turns stay plain text above.
          <div className={MARKDOWN_CLASSES}>
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
        {message.routing && (
          <span className="mt-3 flex items-center gap-2 pt-2 shadow-[inset_0_1px_0_var(--rule)]">
            <RoutingChip routing={message.routing} mode={mode} onSelectMode={onSelectMode} />
          </span>
        )}
      </div>
      <div className="mt-1 flex gap-3 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <button onClick={copy} className="text-[11px] text-ink-faint hover:text-ink">
          {copied ? 'Copied' : 'Copy'}
        </button>
        {onStartEdit && (
          <button
            onClick={onStartEdit}
            disabled={busy}
            className="text-[11px] text-ink-faint hover:text-ink disabled:opacity-40"
          >
            Edit
          </button>
        )}
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            disabled={busy}
            className="text-[11px] text-ink-faint hover:text-ink disabled:opacity-40"
          >
            Regenerate
          </button>
        )}
      </div>
    </div>
  );
});

/**
 * A merged insight rendered inline in the parent transcript at the point it landed — the
 * one-insight merge contract made visible and auditable. Click expands; the link opens the
 * branch that paid it. These lines genuinely enter the model's context every turn.
 */
function InsightChip({
  insight,
  branchTitle,
  highlighted,
  onOpenBranch,
}: {
  insight: Insight;
  branchTitle: string;
  highlighted: boolean;
  onOpenBranch: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = insight.text.length > 140;
  return (
    <div
      className={`flex max-w-[68ch] items-start gap-3 self-center rounded-[var(--radius-bud)] px-4 py-3 text-sm leading-relaxed transition-shadow duration-700 ${
        highlighted ? 'bg-accent-wash ring-2 ring-accent/50' : 'bg-accent-wash/70'
      }`}
    >
      <ArrowBendLeftUp weight="bold" className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-medium text-accent">Merged from {branchTitle}</p>
        <button
          onClick={() => setExpanded((e) => !e)}
          disabled={!long}
          className="mt-0.5 text-left text-ink disabled:cursor-text"
          aria-expanded={long ? expanded : undefined}
        >
          {expanded || !long ? insight.text : `${insight.text.slice(0, 140).trimEnd()}…`}
        </button>
        <button
          onClick={() => onOpenBranch(insight.branchId)}
          className="mt-1 block text-xs text-accent underline underline-offset-2 hover:text-accent-bright"
        >
          Open the branch
        </button>
      </div>
    </div>
  );
}

/** The compiled brief a branch was born with: its facts, recalled lines, and what it left out. */
function BriefPanel({ brief }: { brief: ContextBrief }) {
  return (
    <details open className="group rounded-[var(--radius-bud)] bg-surface-sunk/70 px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-ink-muted">
        <span className="transition-transform group-open:rotate-90" aria-hidden>
          ›
        </span>
        Brief this branch was given
        <span className="tnum ml-auto font-normal text-ink-faint">
          {brief.facts.length} facts · {brief.briefTokens.toLocaleString()} tokens
        </span>
      </summary>
      <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-ink marker:text-ink-faint">
        {brief.facts.map((fact, i) => (
          <li key={i}>{plainFact(fact)}</li>
        ))}
      </ol>
      {brief.recalled && brief.recalled.length > 0 && (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-accent">
            <Sparkle weight="fill" className="h-3.5 w-3.5" aria-hidden />
            Recalled from other branches
          </p>
          <ul className="mt-1.5 flex flex-col gap-1 text-[13px] leading-relaxed text-ink">
            {brief.recalled.map((r, i) => (
              <li key={i}>
                {r.text} <span className="text-ink-faint">({r.source})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs leading-relaxed text-ink-faint">{brief.excludedNote}</p>
    </details>
  );
}

/** The per-fork receipt: the parent context at full width, the brief at true scale. */
function CutReceipt({ brief }: { brief: ContextBrief }) {
  const avoided = Math.max(0, brief.availableTokens - brief.briefTokens);
  return (
    <div className="mt-3 flex flex-col gap-2">
      <CutStrip available={brief.availableTokens} kept={brief.briefTokens} size="lg" />
      <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span>
          <span className="tnum font-medium text-ink">{brief.briefTokens.toLocaleString()}</span> tokens
          sent
        </span>
        <span>
          <span className="tnum">{avoided.toLocaleString()}</span> left on the parent
        </span>
        <span className="font-display text-base font-semibold text-accent">
          <span className="tnum">{brief.prunedPct.toFixed(1)}%</span> pruned
        </span>
      </p>
    </div>
  );
}

export function ChatPane({
  conversation,
  onSend,
  onBranch,
  onSelectMode,
  onMerge,
  onRegenerate,
  onEditMessage,
  onRename,
  onArchive,
  onOpenBranch,
  branchTitles,
  mode,
  sending,
  streamingText,
  branching,
  merging,
  highlightInsightId,
  initialDraft,
  onDraftRestored,
  onLoadDemo,
  onStartTour,
  onCommand,
  demoMode,
}: {
  conversation: Conversation;
  /** Resolves false when the send failed, so the composer can restore the draft. */
  onSend: (content: string) => Promise<boolean>;
  onBranch: (selection: string) => void;
  onSelectMode: (mode: ModeSelection | null) => void;
  /** Takes the button's viewport centre so the merge animation starts where it was clicked. */
  onMerge: (origin: { x: number; y: number }) => void;
  /** Rerun the last exchange; resolves false on failure. */
  onRegenerate: (messageId: string) => Promise<boolean>;
  /** Replace the last user turn and rerun it; resolves false on failure. */
  onEditMessage: (messageId: string, content: string) => Promise<boolean>;
  onRename: (title: string) => Promise<void>;
  /** Toggle archived on this branch. Absent on roots. */
  onArchive?: (archived: boolean) => Promise<void>;
  /** Jump to the branch a merged insight came from. */
  onOpenBranch: (id: string) => void;
  /** Node titles, for labeling inline insight chips. */
  branchTitles: Record<string, string>;
  mode: ModeSelection | null;
  sending: boolean;
  /** The in-flight answer so far. Empty string = waiting for the first token. */
  streamingText: string | null;
  branching: boolean;
  merging: boolean;
  highlightInsightId: string | null;
  /** A draft recovered from a send that failed while this branch was unmounted (branch switch). */
  initialDraft?: string;
  /** Called once this branch's recovered draft has been seeded, so the parent can drop it. */
  onDraftRestored?: () => void;
  /** Fresh-root empty state's CTA — loads the example tree into this session. */
  onLoadDemo?: () => Promise<void>;
  /** The guided 60-second loop: load the demo, then walk branch → merge → ledger. */
  onStartTour?: () => Promise<void>;
  /**
   * A typed tree command ("side question: …", "merge that", "never mind"). An unhandled
   * command is sent as an ordinary message instead.
   */
  onCommand?: (command: TurnCommand, origin: { x: number; y: number }) => Promise<CommandOutcome>;
  /** No provider key: answers come from the extractive mock, and the composer says so. */
  demoMode?: boolean;
}) {
  // Seed from a recovered failed-send draft: ChatPane remounts per branch, so a plain local
  // restore is lost if the user switched branches mid-send. The parent hands it back here.
  const [draft, setDraft] = useState(initialDraft ?? '');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialDraft) onDraftRestored?.();
    // Mount-only: initialDraft is a one-shot hand-off consumed when this branch mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the newest message in view as the thread grows — keyed on the last message's
  // identity, not the count: regenerate and edit replace turns without changing the count.
  const lastMessageId = conversation.messages[conversation.messages.length - 1]?.id ?? null;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lastMessageId, conversation.insights.length, conversation.id]);

  // Follow the stream: every delta grows the page, and the reader should ride the bottom edge.
  useEffect(() => {
    if (streamingText !== null) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [streamingText]);

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

  const messages = conversation.messages;

  /**
   * The transcript timeline: messages and merged insights interleaved by timestamp, so each
   * insight renders where it actually landed in the conversation's history. Items without a
   * timestamp (old fixtures) sort to the front, preserving their relative order.
   */
  const timeline = useMemo(() => {
    const items: ({ kind: 'message'; t: string; m: Message } | { kind: 'insight'; t: string; i: Insight })[] = [
      ...messages.map((m) => ({ kind: 'message' as const, t: m.createdAt ?? '', m })),
      ...conversation.insights.map((i) => ({ kind: 'insight' as const, t: i.createdAt ?? '', i })),
    ];
    return items.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  }, [messages, conversation.insights]);

  const { lastAssistantId, lastUserId } = useMemo(() => {
    const assistantId =
      messages.length > 0 && messages[messages.length - 1].role === 'assistant'
        ? messages[messages.length - 1].id
        : null;
    let userId: string | null = null;
    // An unanswered trailing user turn means a send is in flight — editing it would double-send.
    if (messages.length === 0 || messages[messages.length - 1].role === 'assistant') {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'user') {
          userId = messages[i].id;
          break;
        }
      }
    }
    return { lastAssistantId: assistantId, lastUserId: userId };
  }, [messages]);

  // Stable identities: these reach the memoized last bubbles; fresh closures per keystroke
  // would re-parse their markdown on every draft change.
  const regenerateLast = useCallback(() => {
    if (lastAssistantId) onRegenerate(lastAssistantId);
  }, [lastAssistantId, onRegenerate]);
  const startEditLast = useCallback(() => {
    const target = messages.find((m) => m.id === lastUserId);
    if (target) setEditing({ id: target.id, text: target.content });
  }, [lastUserId, messages]);

  const submitEdit = async () => {
    if (!editing || sending) return;
    const text = editing.text.trim();
    if (!text) return;
    const ok = await onEditMessage(editing.id, text);
    if (ok) setEditing(null);
  };

  const submit = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    const command = onCommand ? parseTurnCommand(content) : null;
    if (command && onCommand) {
      const rect = composerRef.current?.getBoundingClientRect();
      const origin = rect
        ? { x: rect.left + rect.width / 2, y: rect.top }
        : { x: window.innerWidth / 2, y: window.innerHeight - 80 };
      setDraft('');
      const outcome = await onCommand(command, origin);
      if (outcome === 'done') return;
      if (outcome === 'failed') {
        setDraft((current) => current || content);
        return;
      }
    }
    setDraft('');
    const sent = await onSend(content);
    // Failed send: put the text back rather than destroy it — unless the user already
    // started typing something new while the request was in flight.
    if (!sent) setDraft((current) => current || content);
  };

  const isBranch = Boolean(conversation.parentId);
  const lastRouting = [...messages].reverse().find((m) => m.routing)?.routing ?? null;
  const startDemo = (run?: () => Promise<void>) => async () => {
    if (!run) return;
    setDemoLoading(true);
    try {
      await run();
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-surface-raised">
      <header className="px-4 pb-3 pt-3 shadow-[inset_0_-1px_0_var(--rule)] sm:px-8 sm:pb-4 sm:pt-5">
        <div className="mx-auto flex max-w-3xl flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
            <p className="truncate text-xs text-ink-faint">
              {isBranch ? 'Branch' : 'Trunk'}
              {isBranch && lastRouting?.label && (
                <span className="text-ink-muted"> · answered by {lastRouting.label}</span>
              )}
            </p>
            {renaming !== null ? (
              <input
                autoFocus
                aria-label="Branch title"
                value={renaming}
                onChange={(e) => setRenaming(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    const title = renaming.trim();
                    if (title && title !== conversation.title) await onRename(title);
                    setRenaming(null);
                  }
                  if (e.key === 'Escape') setRenaming(null);
                }}
                onBlur={() => setRenaming(null)}
                className="mt-0.5 w-full rounded-md bg-surface px-1.5 py-0.5 font-display text-2xl font-semibold text-ink ring-1 ring-rule-strong focus:outline-none focus:ring-2 focus:ring-accent"
              />
            ) : (
              <h2
                onDoubleClick={() => setRenaming(conversation.title)}
                title="Double-click to rename"
                className="mt-0.5 cursor-text truncate font-display text-xl font-semibold leading-tight text-ink sm:text-2xl"
              >
                {conversation.title}
              </h2>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {isBranch && conversation.archived && onArchive && (
              <button
                onClick={() => onArchive(false)}
                className="rounded-[var(--radius-control)] px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-sunk hover:text-ink"
              >
                Unarchive
              </button>
            )}
            {isBranch && !conversation.archived && onArchive && (
              <button
                onClick={() => onArchive(true)}
                title="Set the branch aside without merging anything back"
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-sunk hover:text-ink"
              >
                <Archive className="h-4 w-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">Archive</span>
              </button>
            )}
            {isBranch && !conversation.archived && (
              <button
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  onMerge({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                }}
                disabled={merging || conversation.messages.length === 0}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-accent px-3.5 py-2 text-xs font-semibold text-white shadow-bud transition-colors hover:bg-accent-bright disabled:opacity-40"
              >
                <GitMerge weight="bold" className="h-4 w-4" aria-hidden />
                {merging ? 'Distilling…' : (
                  <span>
                    Merge<span className="hidden sm:inline"> one line back</span>
                  </span>
                )}
              </button>
            )}
            {isBranch && conversation.archived && (
              <span className="rounded-full bg-surface-sunk px-2.5 py-1 text-xs text-ink-muted">Archived</span>
            )}
            {!isBranch && (
              <p className="text-right text-xs text-ink-faint">
                <span className="tnum block text-lg leading-none text-ink">{formatTokens(tokens)}</span>
                tokens of context
              </p>
            )}
          </div>
        </div>
        {brief && (
          <div className="mx-auto max-w-3xl">
            <CutReceipt brief={brief} />
          </div>
        )}
      </header>

      <div
        ref={scrollRef}
        onMouseUp={captureSelection}
        // Touch selection settles after touchend fires — read it a beat later or the Branch
        // button never appears on phones.
        onTouchEnd={() => setTimeout(captureSelection, 120)}
        onScroll={captureSelection}
        className="flex-1 overflow-y-auto px-4 py-5 sm:px-8"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {brief && <BriefPanel brief={brief} />}

          {/* Fresh root: the loop is invisible until there is text to select, so explain it. */}
          {conversation.messages.length === 0 && !conversation.parentId && !branching && (
            <div className="mx-auto mt-10 flex max-w-md flex-col gap-5">
              <h3 className="font-display text-xl font-semibold text-ink">Start a trunk, then branch off it</h3>
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed text-ink-muted marker:text-ink-faint">
                <li>
                  <span className="text-ink">Ask anything below.</span> The router picks a model
                  and effort for each question.
                </li>
                <li>
                  <span className="text-ink">Select text in an answer and press Branch,</span> or
                  type “side question:” first. The branch gets a compiled brief, not the whole
                  history.
                </li>
                <li>
                  <span className="text-ink">Merge one line back.</span> The branch distills to a
                  single sentence that joins the trunk&apos;s context.
                </li>
              </ol>
              <div className="flex flex-wrap gap-2">
                {onStartTour && (
                  <button
                    onClick={startDemo(onStartTour)}
                    disabled={demoLoading}
                    className="rounded-[var(--radius-control)] bg-accent px-4 py-2 text-sm font-semibold text-white shadow-bud transition-colors hover:bg-accent-bright disabled:opacity-40"
                  >
                    {demoLoading ? 'Growing…' : 'Walk through the loop'}
                  </button>
                )}
                {onLoadDemo && (
                  <button
                    onClick={startDemo(onLoadDemo)}
                    disabled={demoLoading}
                    className="rounded-[var(--radius-control)] bg-surface px-4 py-2 text-sm font-medium text-ink shadow-bud transition-colors hover:bg-accent-wash disabled:opacity-40"
                  >
                    {demoLoading ? 'Growing…' : 'Load the example tree'}
                  </button>
                )}
              </div>
              <p className="text-xs text-ink-faint">
                <a
                  href="https://github.com/TarunYadgirkar/Bonsai"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-ink"
                >
                  Read the source on GitHub
                </a>
                {' or '}
                <a href="/connect" className="underline underline-offset-2 hover:text-ink">
                  use Bonsai inside claude.ai
                </a>
                .
              </p>
            </div>
          )}

          {timeline.map((item) =>
            item.kind === 'insight' ? (
              <InsightChip
                key={item.i.id}
                insight={item.i}
                branchTitle={branchTitles[item.i.branchId] ?? 'a pruned branch'}
                highlighted={item.i.id === highlightInsightId}
                onOpenBranch={onOpenBranch}
              />
            ) : editing?.id === item.m.id ? (
              <div key={item.m.id} className="flex flex-col items-end gap-1.5">
                <textarea
                  autoFocus
                  aria-label="Edit your message"
                  value={editing.text}
                  onChange={(e) => setEditing({ id: item.m.id, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submitEdit();
                    }
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  rows={Math.min(8, Math.max(2, editing.text.split('\n').length))}
                  className="w-[85%] resize-none rounded-[var(--radius-bud)] bg-accent-wash px-4 py-3 text-[15px] leading-relaxed text-ink ring-2 ring-accent focus:outline-none"
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => setEditing(null)}
                    className="text-xs text-ink-faint hover:text-ink"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitEdit}
                    disabled={sending || !editing.text.trim()}
                    className="text-xs font-semibold text-accent hover:text-accent-bright disabled:opacity-40"
                  >
                    {sending ? 'Rerunning…' : 'Save and rerun'}
                  </button>
                </div>
              </div>
            ) : (
              <MessageBubble
                key={item.m.id}
                message={item.m}
                mode={mode}
                onSelectMode={onSelectMode}
                busy={sending}
                onRegenerate={
                  item.m.id === lastAssistantId && !conversation.archived
                    ? regenerateLast
                    : undefined
                }
                onStartEdit={
                  item.m.id === lastUserId && !conversation.archived
                    ? startEditLast
                    : undefined
                }
              />
            ),
          )}

          {branching && <p className="text-sm text-accent">Compiling the branch brief…</p>}
          {streamingText !== null && streamingText.length > 0 && (
            <div className="flex justify-start">
              <div className="max-w-[min(85%,68ch)] rounded-[var(--radius-bud)] bg-surface-raised px-4 py-3 text-[15px] leading-relaxed text-ink shadow-bud">
                <div className={MARKDOWN_CLASSES}>
                  <ReactMarkdown>{streamingText}</ReactMarkdown>
                </div>
                <span className="mt-1 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-accent align-text-bottom" />
              </div>
            </div>
          )}
          {sending && !streamingText && <p className="text-sm text-ink-faint">Thinking…</p>}
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
          // Clamped so a selection near either edge of a phone screen keeps the button on it.
          style={{
            left: Math.min(Math.max(selection.x, BRANCH_BUTTON_HALF), window.innerWidth - BRANCH_BUTTON_HALF),
            top: selection.y - 10,
          }}
          className="fixed z-40 inline-flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-white shadow-lift transition-colors hover:bg-accent-bright"
        >
          <GitFork weight="bold" className="h-3.5 w-3.5" aria-hidden />
          Branch from here
        </button>
      )}

      <footer className="px-4 pb-3 pt-3 shadow-[inset_0_1px_0_var(--rule)] sm:px-8">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            ref={composerRef}
            aria-label={isBranch ? 'Message this branch' : 'Message the trunk'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={
              isBranch
                ? 'Ask a follow-up, or type “merge that”'
                : 'Ask anything, or start with “side question:”'
            }
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-[var(--radius-control)] bg-surface px-3.5 py-2.5 text-[15px] text-ink ring-1 ring-rule-strong placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            onClick={submit}
            disabled={sending || !draft.trim()}
            aria-label="Send"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-control)] bg-accent text-white shadow-bud transition-colors hover:bg-accent-bright disabled:opacity-30"
          >
            <ArrowUp weight="bold" className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-[11px] leading-snug text-ink-faint">
          {mode?.mode === 'manual'
            ? 'This branch is pinned to one model, so classification is skipped here. '
            : ''}
          {demoMode
            ? 'Demo mode: answers come from an extractive mock. Briefs, routing, and pruning are computed for real.'
            : ''}
        </p>
      </footer>
    </section>
  );
}
