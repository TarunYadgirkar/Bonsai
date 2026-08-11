import { describe, expect, it } from 'vitest';
import { estimateTokens, messagesTokens, prunedPct } from '../src/tokens';
import type { Message } from '../src/types';

const msg = (id: string, content: string): Message => ({ id, role: 'user', content });

describe('estimateTokens', () => {
  it('rounds up at 4 chars per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});

describe('messagesTokens', () => {
  it('adds 4 tokens of overhead per message', () => {
    expect(messagesTokens([])).toBe(0);
    expect(messagesTokens([msg('1', 'abcd')])).toBe(5);
    expect(messagesTokens([msg('1', 'abcd'), msg('2', 'abcdefgh')])).toBe(11);
  });

  it('bills overhead even for empty content', () => {
    expect(messagesTokens([msg('1', '')])).toBe(4);
  });
});

describe('prunedPct', () => {
  it('rounds to one decimal', () => {
    expect(prunedPct(1000, 32)).toBe(96.8);
    expect(prunedPct(3, 1)).toBe(66.7);
    expect(prunedPct(100, 100)).toBe(0);
    expect(prunedPct(100, 0)).toBe(100);
  });

  it('returns 0 when nothing was available', () => {
    expect(prunedPct(0, 50)).toBe(0);
    expect(prunedPct(-10, 50)).toBe(0);
  });

  it('floors at 0 when kept exceeds available', () => {
    expect(prunedPct(100, 150)).toBe(0);
    expect(prunedPct(200, 250)).toBe(0);
  });
});
