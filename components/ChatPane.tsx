'use client';

import { useEffect, useRef, useState } from 'react';
import type { Conversation } from '@/lib/types';
import { TierBadge } from './TierBadge';
import { conversationTokens, formatTokens } from './tokens';

export function ChatPane({
  conversation,
  onSend,
  sending,
}: {
  conversation: Conversation;
  onSend: (content: string) => void;
  sending: boolean;
}) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [conversation.messages.length, conversation.id]);

  const tokens = conversationTokens(conversation.messages);

  const submit = () => {
    const content = draft.trim();
    if (!content || sending) return;
    onSend(content);
    setDraft('');
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-neutral-900">
      <header className="flex items-center gap-3 border-b border-white/10 px-6 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-white">
            {conversation.title}
          </h2>
          {conversation.brief && (
            <p className="truncate text-[11px] text-neutral-500">
              branched on “{conversation.brief.selection}” ·{' '}
              {conversation.brief.prunedPct.toFixed(1)}% pruned
            </p>
          )}
        </div>

        {/* Running input-token counter — DEMO.md Beat 1 points straight at this. */}
        <div className="ml-auto shrink-0 text-right">
          <div className="font-mono text-lg leading-none tabular-nums text-white">
            {formatTokens(tokens)}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">
            context tokens
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {conversation.insights.length > 0 && (
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-emerald-300/70">
                Merged insights
              </div>
              {conversation.insights.map((insight) => (
                <p key={insight.id} className="mt-1 text-xs text-emerald-100">
                  {insight.text}
                </p>
              ))}
            </div>
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
                  <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2">
                    <TierBadge tier={message.routing.tier} size="sm" />
                    <span className="text-[10px] tabular-nums text-neutral-500">
                      {formatTokens(message.routing.contextTokens)} ctx · $
                      {message.routing.estCostUsd.toFixed(4)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}

          {sending && (
            <div className="text-xs text-neutral-500">Thinking…</div>
          )}
        </div>
      </div>

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
      </footer>
    </section>
  );
}
