import type { Message } from '@/lib/types';

/**
 * Display-only token estimate: ~4 chars per token — the same heuristic the seed fixture was
 * sized against, so the fixture's "~19k available" headline moves if this divisor changes.
 *
 * Authoritative counts come from the engine (RoutingDecision.contextTokens,
 * ContextBrief.availableTokens) and always win where present. This only exists so
 * the counter has something to show for messages the engine hasn't costed yet.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function conversationTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

/** 18626 → "18.6k"; small numbers stay exact. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

/**
 * Demo-scale money: a single quick-tier call costs ~$0.0002, so two decimals would
 * render the whole session as "$0.00". Four decimals under a dollar.
 */
export function formatUsd(n: number): string {
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}
