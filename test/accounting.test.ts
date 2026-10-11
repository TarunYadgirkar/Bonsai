import { describe, expect, it } from 'vitest';
import { MODEL_TIERS, warmBaselineCostUsd } from 'bonsai-engine';
import { buildLog } from '../lib/accounting';

describe('buildLog', () => {
  it('prices the warm baseline when the row is logged, so later rate changes cannot mix epochs', () => {
    const log = buildLog({
      branchId: 'b1',
      purpose: 'chat',
      tier: 'quick',
      inputTokens: 300,
      outputTokens: 50,
      baselineInputTokens: 19_000,
    });
    expect(log.warmBaselineCostUsd).toBe(
      warmBaselineCostUsd(MODEL_TIERS.deep, log.baselineInputTokens, log.outputTokens),
    );
    expect(log.warmBaselineCostUsd).toBeLessThan(log.baselineCostUsd);
  });
});
