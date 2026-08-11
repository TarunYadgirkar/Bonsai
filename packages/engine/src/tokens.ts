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

/**
 * Rounded to one decimal so the tree edge reads "96.8%" rather than "96.83527%".
 * Floored at 0: a brief larger than a tiny parent is "nothing pruned", not negative pruning.
 */
export function prunedPct(available: number, kept: number): number {
  if (available <= 0) return 0;
  return Math.max(0, Math.round(((available - kept) / available) * 1000) / 10);
}

/**
 * Tokenizer-generation multipliers vs the chars/4 base, keyed by model-id prefix (longest
 * match wins, so date-suffixed upstream ids resolve too). The 4.7+/5-family tokenizer
 * produces ~1.3x more tokens for the same text than claude-haiku-4-5 and earlier
 * (verified against official docs, 2026-08-10). chars/4 itself is a rough English
 * approximation with ±10%+ error, worse on code and numbers — real counts always come
 * from provider usage.
 */
export const TOKENIZER_GENERATION: Record<string, number> = {
  'claude-haiku-4-5': 1.0,
  'claude-haiku-4': 1.0,
  'claude-haiku-5': 1.3,
  'claude-sonnet-4-7': 1.3,
  'claude-sonnet-4-8': 1.3,
  'claude-sonnet-4': 1.0,
  'claude-sonnet-5': 1.3,
  'claude-opus-4-7': 1.3,
  'claude-opus-4-8': 1.3,
  'claude-opus-4': 1.0,
  'claude-opus-5': 1.3,
  'claude-fable-5': 1.3,
  'claude-3': 1.0,
};

/** Unknown ids are assumed current-generation: overestimating is the safe failure mode. */
export const DEFAULT_TOKENIZER_FACTOR = 1.3;

export function tokenizerFactor(modelId: string): number {
  let bestPrefix = '';
  let factor = DEFAULT_TOKENIZER_FACTOR;
  for (const [prefix, f] of Object.entries(TOKENIZER_GENERATION)) {
    if (modelId.startsWith(prefix) && prefix.length > bestPrefix.length) {
      bestPrefix = prefix;
      factor = f;
    }
  }
  return factor;
}

/**
 * Model-aware estimate: the chars/4 base scaled by the model's tokenizer generation.
 * Identical to estimateTokens() for factor-1.0 models.
 */
export function estimateTokensFor(text: string, modelId: string): number {
  return Math.ceil((text.length / 4) * tokenizerFactor(modelId));
}
