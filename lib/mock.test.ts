import { describe, expect, it } from 'vitest';
import { buildLog } from './mock';

describe('buildLog counterfactual baseline', () => {
  it('prices a zero-token baseline at exactly zero', () => {
    const log = buildLog({
      branchId: 'branch-1',
      purpose: 'compile',
      completion: {
        text: 'compiled',
        tier: 'quick',
        model: 'claude-haiku-4-5',
        effort: 'low',
        inputTokens: 100,
        outputTokens: 25,
        estCostUsd: 0.000225,
        mock: true,
      },
      status: 'succeeded',
      baselineInputTokens: 0,
    });

    expect(log.baselineInputTokens).toBe(0);
    expect(log.baselineCostUsd).toBe(0);
  });
});
