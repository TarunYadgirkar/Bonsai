import { describe, expect, it } from 'vitest';
import { estimateTokens, prunedPct } from './tokens';

describe('token estimates', () => {
  it('rounds text tokens and pruning exactly as the UI expects', () => {
    expect(estimateTokens('12345')).toBe(2);
    expect(prunedPct(1_000, 250)).toBe(75);
  });

  it('clamps pruning to the persisted percentage range', () => {
    expect(prunedPct(10, 20)).toBe(0);
    expect(prunedPct(10, -1)).toBe(100);
  });
});
