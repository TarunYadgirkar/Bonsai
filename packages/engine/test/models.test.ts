import { describe, expect, it } from 'vitest';
import {
  CEILING_MODEL,
  EFFORTS,
  MODELS,
  MODEL_TIERS,
  TIER_DEFAULTS,
  costForModel,
  effortSpec,
  estimateCostUsd,
  modelSpec,
  routingLabel,
  tierFor,
} from '../src/models';
import type { Effort, Tier } from '../src/types';

const TIERS: Tier[] = ['quick', 'thoughtful', 'deep'];

describe('modelSpec', () => {
  it('resolves each catalog id', () => {
    expect(modelSpec('claude-haiku-4-5').label).toBe('Haiku 4.5');
    expect(modelSpec('claude-sonnet-5').label).toBe('Sonnet 5');
    expect(modelSpec('claude-opus-5').label).toBe('Opus 5');
    expect(modelSpec('claude-fable-5').input).toBe(10);
  });

  it('falls back to the first model on unknown ids', () => {
    expect(modelSpec('gpt-4o')).toBe(MODELS[0]);
    expect(modelSpec('').id).toBe('claude-haiku-4-5');
  });
});

describe('costForModel', () => {
  it('prices per million tokens at the model rates', () => {
    expect(costForModel('claude-opus-5', 1000, 200)).toBe(0.01);
    expect(costForModel('claude-haiku-4-5', 123, 456)).toBe(0.002403);
    expect(costForModel('claude-fable-5', 1_000_000, 0)).toBe(10);
    expect(costForModel('claude-sonnet-5', 0, 0)).toBe(0);
  });

  it('rounds to six decimals', () => {
    expect(costForModel('claude-haiku-4-5', 0.3, 0)).toBe(0);
    expect(costForModel('claude-haiku-4-5', 0.5, 0)).toBe(0.000001);
  });

  it('prices unknown models at the fallback model rates', () => {
    expect(costForModel('nope', 1_000_000, 1_000_000)).toBe(6);
  });
});

describe('estimateCostUsd', () => {
  it('prices a tier at its default model', () => {
    expect(estimateCostUsd('deep', 1000, 200)).toBe(costForModel('claude-opus-5', 1000, 200));
    expect(estimateCostUsd('quick', 1000, 200)).toBe(costForModel('claude-haiku-4-5', 1000, 200));
  });
});

describe('tierFor', () => {
  it('maps each model to its tier', () => {
    expect(tierFor('claude-haiku-4-5')).toBe('quick');
    expect(tierFor('claude-sonnet-5')).toBe('thoughtful');
    expect(tierFor('claude-opus-5')).toBe('deep');
    expect(tierFor('claude-fable-5')).toBe('deep');
  });

  it('falls back to quick on unknown ids', () => {
    expect(tierFor('gpt-4o')).toBe('quick');
  });
});

describe('effortSpec', () => {
  it('resolves each level with its output ceiling', () => {
    expect(effortSpec('low').maxTokens).toBe(300);
    expect(effortSpec('medium').maxTokens).toBe(700);
    expect(effortSpec('high').maxTokens).toBe(1500);
    expect(effortSpec('max').maxTokens).toBe(3000);
  });

  it('falls back to the first effort on unknown levels', () => {
    expect(effortSpec('turbo' as unknown as Effort).level).toBe('low');
  });
});

describe('routingLabel', () => {
  it('reads model · effort', () => {
    expect(routingLabel('claude-opus-5', 'high')).toBe('Opus 5 · High effort');
    expect(routingLabel('claude-sonnet-5', 'medium')).toBe('Sonnet 5 · Medium effort');
    expect(routingLabel('claude-fable-5', 'max')).toBe('Fable 5 · Max effort');
  });

  it('inherits both fallbacks on unknown inputs', () => {
    expect(routingLabel('nope', 'turbo' as unknown as Effort)).toBe('Haiku 4.5 · Low effort');
  });
});

describe('catalog consistency', () => {
  it('MODEL_TIERS mirrors TIER_DEFAULTS and each default model owns its tier', () => {
    for (const tier of TIERS) {
      expect(MODEL_TIERS[tier]).toBe(TIER_DEFAULTS[tier].model);
      expect(modelSpec(TIER_DEFAULTS[tier].model).tier).toBe(tier);
    }
  });

  it('efforts ladder low → max', () => {
    expect(EFFORTS.map((e) => e.level)).toEqual(['low', 'medium', 'high', 'max']);
  });

  it('CEILING_MODEL is claude-fable-5 and sits in the catalog on deep', () => {
    expect(CEILING_MODEL).toBe('claude-fable-5');
    expect(MODELS.some((m) => m.id === CEILING_MODEL)).toBe(true);
    expect(modelSpec(CEILING_MODEL).tier).toBe('deep');
  });
});
