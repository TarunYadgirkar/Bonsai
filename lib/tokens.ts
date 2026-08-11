import type { Message } from './types';

/** ~4 chars per token. Good enough for the counters; real usage comes from the API response. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Per-message overhead for role/framing, matching what a chat API actually bills. */
const MESSAGE_OVERHEAD_TOKENS = 4;

export function messagesTokens(messages: Message[]): number {
  return messages.reduce(
    (sum, m) => sum + estimateTokens(m.content) + MESSAGE_OVERHEAD_TOKENS,
    0,
  );
}

/** Rounded to one decimal so the tree edge reads "96.8%" rather than "96.83527%". */
export function prunedPct(available: number, kept: number): number {
  if (available <= 0) return 0;
  const percentage = Math.round(((available - kept) / available) * 1000) / 10;
  return Math.min(100, Math.max(0, percentage));
}
