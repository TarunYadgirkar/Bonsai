import { describe, expect, it } from 'vitest';
import {
  combineFigures,
  estimatedFigure,
  measuredFigure,
  savingsCurve,
  sessionStats,
  type StatsLog,
} from '../src/stats';
import {
  DEFAULT_TOKENIZER_FACTOR,
  TOKENIZER_GENERATION,
  estimateTokens,
  estimateTokensFor,
  tokenizerFactor,
} from '../src/tokens';

let seq = 0;
const log = (overrides: Partial<StatsLog> = {}): StatsLog => {
  seq += 1;
  return {
    id: `log-${seq}`,
    ts: new Date(1754800000000 + seq * 1000).toISOString(),
    branchId: 'b1',
    purpose: 'chat',
    tier: 'quick',
    model: 'claude-haiku-4-5',
    effort: 'low',
    inputTokens: 100,
    outputTokens: 50,
    estCostUsd: 0.00035,
    escalated: false,
    overridden: false,
    baselineInputTokens: 1000,
    baselineCostUsd: 0.00625,
    ...overrides,
  };
};

/** Mixed purposes, models, escalation, and an override — all rows flagged measured. */
const fixture = (): StatsLog[] => [
  log({ purpose: 'chat', model: 'claude-haiku-4-5', measured: true }),
  log({
    purpose: 'chat',
    model: 'claude-sonnet-5',
    tier: 'thoughtful',
    effort: 'medium',
    inputTokens: 200,
    outputTokens: 100,
    estCostUsd: 0.0021,
    escalated: true,
    baselineInputTokens: 2000,
    baselineCostUsd: 0.0125,
    measured: true,
  }),
  log({
    purpose: 'chat',
    model: 'claude-opus-5',
    tier: 'deep',
    effort: 'high',
    inputTokens: 300,
    outputTokens: 100,
    estCostUsd: 0.004,
    overridden: true,
    baselineInputTokens: 3000,
    baselineCostUsd: 0.0175,
    measured: true,
  }),
  log({
    purpose: 'compile',
    inputTokens: 400,
    outputTokens: 80,
    estCostUsd: 0.0008,
    baselineInputTokens: 400,
    baselineCostUsd: 0.004,
    measured: true,
  }),
  log({
    purpose: 'classify',
    inputTokens: 150,
    outputTokens: 10,
    estCostUsd: 0.0002,
    baselineInputTokens: 150,
    baselineCostUsd: 0.001,
    measured: true,
  }),
  log({
    purpose: 'merge',
    inputTokens: 250,
    outputTokens: 20,
    estCostUsd: 0.00035,
    baselineInputTokens: 250,
    baselineCostUsd: 0.00175,
    measured: true,
  }),
];

describe('TOKENIZER_GENERATION', () => {
  it('pins the verified factors: 1.0 for haiku-4-5/older, 1.3 for 5-family and 4.7+', () => {
    expect(TOKENIZER_GENERATION['claude-haiku-4-5']).toBe(1.0);
    expect(TOKENIZER_GENERATION['claude-sonnet-5']).toBe(1.3);
    expect(TOKENIZER_GENERATION['claude-opus-5']).toBe(1.3);
    expect(TOKENIZER_GENERATION['claude-fable-5']).toBe(1.3);
    expect(TOKENIZER_GENERATION['claude-opus-4-7']).toBe(1.3);
    expect(TOKENIZER_GENERATION['claude-opus-4-8']).toBe(1.3);
    expect(TOKENIZER_GENERATION['claude-opus-4']).toBe(1.0);
    expect(TOKENIZER_GENERATION['claude-3']).toBe(1.0);
  });
});

describe('tokenizerFactor', () => {
  it('resolves the catalog models', () => {
    expect(tokenizerFactor('claude-haiku-4-5')).toBe(1.0);
    expect(tokenizerFactor('claude-sonnet-5')).toBe(1.3);
    expect(tokenizerFactor('claude-opus-5')).toBe(1.3);
    expect(tokenizerFactor('claude-fable-5')).toBe(1.3);
  });

  it('matches by prefix, so date-suffixed upstream ids resolve', () => {
    expect(tokenizerFactor('claude-haiku-4-5-20251001')).toBe(1.0);
    expect(tokenizerFactor('claude-opus-4-7-20260115')).toBe(1.3);
  });

  it('prefers the longest matching prefix', () => {
    // 'claude-opus-4' (1.0) and 'claude-opus-4-8' (1.3) both match; the longer one wins.
    expect(tokenizerFactor('claude-opus-4-8')).toBe(1.3);
    // Bare 4.x that is not 4.7/4.8 falls to the shorter 'claude-opus-4' prefix.
    expect(tokenizerFactor('claude-opus-4-1')).toBe(1.0);
    expect(tokenizerFactor('claude-3-5-sonnet')).toBe(1.0);
  });

  it('falls back to the current-generation default for unknown ids', () => {
    expect(tokenizerFactor('gpt-5.5')).toBe(DEFAULT_TOKENIZER_FACTOR);
    expect(tokenizerFactor('')).toBe(DEFAULT_TOKENIZER_FACTOR);
  });
});

describe('estimateTokensFor', () => {
  it('is chars/4 times the generation factor', () => {
    const text = 'a'.repeat(400); // 100 base tokens
    expect(estimateTokensFor(text, 'claude-haiku-4-5')).toBe(100);
    expect(estimateTokensFor(text, 'claude-opus-5')).toBe(130);
    expect(estimateTokensFor(text, 'claude-fable-5')).toBe(130);
  });

  it('rounds up and handles empty text', () => {
    expect(estimateTokensFor('', 'claude-opus-5')).toBe(0);
    expect(estimateTokensFor('abcde', 'claude-haiku-4-5')).toBe(2); // 1.25 → 2
    expect(estimateTokensFor('abcde', 'claude-opus-5')).toBe(2); // 1.625 → 2
  });

  it('agrees with the legacy estimator for factor-1.0 models', () => {
    for (const text of ['', 'abc', 'abcd', 'a'.repeat(401)]) {
      expect(estimateTokensFor(text, 'claude-haiku-4-5')).toBe(estimateTokens(text));
    }
  });
});

describe('TokenFigure combining', () => {
  it('constructs figures with the right basis', () => {
    expect(measuredFigure(7)).toEqual({ value: 7, basis: 'measured' });
    expect(estimatedFigure(7)).toEqual({ value: 7, basis: 'estimated' });
  });

  it('sums values and stays measured when every part is measured', () => {
    expect(combineFigures([measuredFigure(10), measuredFigure(32)])).toEqual({
      value: 42,
      basis: 'measured',
    });
  });

  it('degrades to estimated when any part is estimated', () => {
    expect(combineFigures([measuredFigure(10), estimatedFigure(1), measuredFigure(5)])).toEqual({
      value: 16,
      basis: 'estimated',
    });
  });

  it('treats the empty sum as measured — zero of anything is exact', () => {
    expect(combineFigures([])).toEqual({ value: 0, basis: 'measured' });
  });
});

describe('sessionStats', () => {
  it('totals input, output, and cost across the log', () => {
    const stats = sessionStats(fixture());
    expect(stats.inferenceCount).toBe(6);
    expect(stats.totals.inputTokens.value).toBe(1400);
    expect(stats.totals.outputTokens.value).toBe(360);
    expect(stats.totals.costUsd.value).toBeCloseTo(0.0078, 6);
  });

  it('reports measured basis only when every row is measured', () => {
    const measuredStats = sessionStats(fixture());
    expect(measuredStats.basis).toBe('measured');
    expect(measuredStats.totals.inputTokens.basis).toBe('measured');

    const rows = fixture();
    const mixed = [...rows.slice(0, 3), { ...rows[3], measured: undefined }, ...rows.slice(4)];
    const mixedStats = sessionStats(mixed);
    expect(mixedStats.basis).toBe('estimated');
    expect(mixedStats.totals.costUsd.basis).toBe('estimated');
  });

  it('treats rows without the measured flag as estimated', () => {
    expect(sessionStats([log()]).basis).toBe('estimated');
  });

  it('computes savings against the modeled baseline', () => {
    const { savings } = sessionStats(fixture());
    expect(savings.baselineInputTokens).toBe(6800);
    expect(savings.baselineCostUsd).toBeCloseTo(0.043, 6);
    expect(savings.tokensSaved).toBe(5400);
    expect(savings.costSavedUsd).toBeCloseTo(0.0352, 6);
    expect(savings.tokensSavedPct).toBe(79.4);
    expect(savings.costSavedPct).toBe(81.9);
  });

  it('breaks down by purpose in canonical order with cost shares summing to ~100', () => {
    const { byPurpose } = sessionStats(fixture());
    expect(byPurpose.map((p) => p.purpose)).toEqual(['chat', 'compile', 'classify', 'merge']);

    const chat = byPurpose[0];
    expect(chat.count).toBe(3);
    expect(chat.inputTokens).toBe(600);
    expect(chat.outputTokens).toBe(250);
    expect(chat.costUsd).toBeCloseTo(0.00645, 6);
    expect(chat.costSharePct).toBe(82.7);

    const shareSum = byPurpose.reduce((s, p) => s + p.costSharePct, 0);
    expect(Math.abs(shareSum - 100)).toBeLessThanOrEqual(0.3); // one-decimal rounding
  });

  it('omits purposes with no rows', () => {
    const { byPurpose } = sessionStats([log({ purpose: 'chat' })]);
    expect(byPurpose.map((p) => p.purpose)).toEqual(['chat']);
  });

  it('breaks down by model, biggest spend first, with catalog labels', () => {
    const { byModel } = sessionStats(fixture());
    expect(byModel.map((m) => m.model)).toEqual([
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ]);
    expect(byModel.map((m) => m.label)).toEqual(['Opus 5', 'Sonnet 5', 'Haiku 4.5']);
    const haiku = byModel[2];
    expect(haiku.count).toBe(4);
    expect(haiku.costUsd).toBeCloseTo(0.0017, 6);
  });

  it('labels unknown model ids with the raw id, never the catalog fallback', () => {
    const { byModel } = sessionStats([log({ model: 'gpt-5.5' })]);
    expect(byModel[0].label).toBe('gpt-5.5');
  });

  it('computes escalation and override rates over chat rows only', () => {
    const stats = sessionStats(fixture());
    // 1 of 3 chat answers escalated, 1 of 3 pinned; internal calls never dilute the rate.
    expect(stats.escalationRatePct).toBe(33.3);
    expect(stats.overriddenRatePct).toBe(33.3);
  });

  it('handles an empty log without dividing by zero', () => {
    const stats = sessionStats([]);
    expect(stats.inferenceCount).toBe(0);
    expect(stats.totals.costUsd).toEqual({ value: 0, basis: 'measured' });
    expect(stats.savings.tokensSavedPct).toBe(0);
    expect(stats.byPurpose).toEqual([]);
    expect(stats.byModel).toEqual([]);
    expect(stats.escalationRatePct).toBe(0);
    expect(stats.overriddenRatePct).toBe(0);
  });
});

describe('savingsCurve', () => {
  it('emits one cumulative point per inference, 1-indexed', () => {
    const curve = savingsCurve(fixture());
    expect(curve).toHaveLength(6);
    expect(curve.map((p) => p.i)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(curve[0]).toEqual({ i: 1, actual: 0.00035, baseline: 0.00625 });
    expect(curve[5].actual).toBeCloseTo(0.0078, 6);
    expect(curve[5].baseline).toBeCloseTo(0.043, 6);
  });

  it('is monotonically non-decreasing in both series', () => {
    const curve = savingsCurve(fixture());
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i].actual).toBeGreaterThanOrEqual(curve[i - 1].actual);
      expect(curve[i].baseline).toBeGreaterThanOrEqual(curve[i - 1].baseline);
    }
  });

  it('matches the session totals at its last point', () => {
    const logs = fixture();
    const stats = sessionStats(logs);
    const curve = savingsCurve(logs);
    expect(curve[curve.length - 1].actual).toBeCloseTo(stats.totals.costUsd.value, 6);
    expect(curve[curve.length - 1].baseline).toBeCloseTo(stats.savings.baselineCostUsd, 6);
  });

  it('returns an empty curve for an empty log', () => {
    expect(savingsCurve([])).toEqual([]);
  });
});
