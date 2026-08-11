import { afterEach, describe, expect, it, vi } from 'vitest';
import { CEILING_MODEL, costForModel, effortNote, modelSpec, routingLabel } from '../src/models';
import { answerFailsSanityCheck, completeWithEscalation, route } from '../src/router';
import type { ContextBrief, Effort, RoutingDecision, Tier } from '../src/types';
import { fakeComplete, llmResult } from './helpers';

const GOOD =
  'Free Ventures applications close September 11, with an info session on September 3.';
const PUNT = "I don't have enough context in this brief to answer that question.";

const brief: ContextBrief = {
  id: 'brief-1',
  branchId: 'b1',
  selection: 'Free Ventures',
  markdown: '# Branch brief — Free Ventures',
  facts: [
    'Free Ventures applications close September 11.',
    'The info session is September 3.',
  ],
  excludedNote: 'Excluded: everything else.',
  availableTokens: 4000,
  briefTokens: 120,
  prunedPct: 97,
};

function routingFor(
  tier: Tier,
  model: string,
  effort: Effort,
  overrides: Partial<RoutingDecision> = {},
): RoutingDecision {
  return {
    tier,
    model,
    effort,
    modelLabel: modelSpec(model).label,
    label: routingLabel(model, effort),
    effortNote: effortNote(model, effort),
    contextTokens: 400,
    estCostUsd: 0,
    reason: 'Classified.',
    complexity: 2,
    escalated: false,
    overridden: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('route — manual mode', () => {
  it('skips classification and defaults effort from the model tier', async () => {
    const { complete, calls } = fakeComplete([]);
    const d = await route(
      {
        question: 'Anything',
        contextTokens: 400,
        mode: { mode: 'manual', model: 'claude-opus-5' },
      },
      { complete },
    );
    expect(calls).toHaveLength(0);
    expect(d.overridden).toBe(true);
    expect(d.escalated).toBe(false);
    expect(d.tier).toBe('deep');
    expect(d.model).toBe('claude-opus-5');
    expect(d.effort).toBe('high');
    expect(d.modelLabel).toBe('Opus 5');
    expect(d.label).toBe('Opus 5 · High effort');
    expect(d.complexity).toBe(3);
    expect(d.reason).toBe('You picked Opus 5 at High effort; classification skipped.');
    expect(d.contextTokens).toBe(400);
    expect(d.estCostUsd).toBe(costForModel('claude-opus-5', 400, 750));
    expect(d.coveredByBrief).toBeUndefined();
  });

  it('honors a named effort', async () => {
    const { complete, calls } = fakeComplete([]);
    const d = await route(
      {
        question: 'Anything',
        contextTokens: 100,
        mode: { mode: 'manual', model: 'claude-haiku-4-5', effort: 'max' },
      },
      { complete },
    );
    expect(calls).toHaveLength(0);
    expect(d.overridden).toBe(true);
    expect(d.tier).toBe('quick');
    expect(d.effort).toBe('max');
    expect(d.complexity).toBe(1);
    expect(d.estCostUsd).toBe(costForModel('claude-haiku-4-5', 100, 1500));
  });
});

describe('route — pinned mode', () => {
  it('beats a pinned tier', async () => {
    const { complete, calls } = fakeComplete([]);
    const d = await route(
      {
        question: 'Anything',
        contextTokens: 400,
        pinnedTier: 'quick',
        pinnedMode: { mode: 'manual', model: 'claude-sonnet-5', effort: 'high' },
      },
      { complete },
    );
    expect(calls).toHaveLength(0);
    expect(d.overridden).toBe(true);
    expect(d.tier).toBe('thoughtful');
    expect(d.model).toBe('claude-sonnet-5');
    expect(d.effort).toBe('high');
    expect(d.reason).toBe('You picked Sonnet 5 at High effort; classification skipped.');
    expect(d.coveredByBrief).toBeUndefined();
  });

  it('loses to an explicit per-request mode', async () => {
    const { complete, calls } = fakeComplete([]);
    const d = await route(
      {
        question: 'Anything',
        contextTokens: 400,
        mode: { mode: 'manual', model: 'claude-opus-5' },
        pinnedMode: { mode: 'manual', model: 'claude-haiku-4-5', effort: 'low' },
      },
      { complete },
    );
    expect(calls).toHaveLength(0);
    expect(d.model).toBe('claude-opus-5');
    expect(d.effort).toBe('high');
  });

  it('falls through to the pinned tier when auto-shaped', async () => {
    const { complete, calls } = fakeComplete([]);
    const d = await route(
      {
        question: 'Anything',
        contextTokens: 400,
        pinnedTier: 'thoughtful',
        pinnedMode: { mode: 'auto' },
      },
      { complete },
    );
    expect(calls).toHaveLength(0);
    expect(d.overridden).toBe(true);
    expect(d.tier).toBe('thoughtful');
    expect(d.reason).toBe(
      'Branch pinned to Sonnet 5 · Medium effort by you; classification skipped.',
    );
  });
});

describe('route — pinned tier', () => {
  it('skips classification', async () => {
    const { complete, calls } = fakeComplete([]);
    const d = await route({ question: 'Anything', contextTokens: 400, pinnedTier: 'deep' }, {
      complete,
    });
    expect(calls).toHaveLength(0);
    expect(d.overridden).toBe(true);
    expect(d.tier).toBe('deep');
    expect(d.model).toBe('claude-opus-5');
    expect(d.effort).toBe('high');
    expect(d.complexity).toBe(3);
    expect(d.reason).toBe('Branch pinned to Opus 5 · High effort by you; classification skipped.');
    expect(d.coveredByBrief).toBeUndefined();
  });

  it('maps each pinned tier to its own complexity', async () => {
    const { complete, calls } = fakeComplete([]);
    const quick = await route(
      { question: 'Anything', contextTokens: 400, pinnedTier: 'quick' },
      { complete },
    );
    const thoughtful = await route(
      { question: 'Anything', contextTokens: 400, pinnedTier: 'thoughtful' },
      { complete },
    );
    expect(calls).toHaveLength(0);
    expect(quick.tier).toBe('quick');
    expect(quick.complexity).toBe(1);
    expect(thoughtful.tier).toBe('thoughtful');
    expect(thoughtful.complexity).toBe(2);
  });
});

describe('route — auto mode', () => {
  it('classifies on the quick tier and routes complexity 3 to deep', async () => {
    const { complete, calls } = fakeComplete([
      llmResult('{"complexity": 3, "covered": true, "reason": "weighs trade-offs"}'),
    ]);
    const d = await route(
      { question: 'Rank the clubs by opportunity cost.', contextTokens: 400 },
      { complete },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].tier).toBe('quick');
    expect(calls[0].purpose).toBe('classify');
    expect(calls[0].maxTokens).toBe(120);
    expect(calls[0].messages[1].content).toContain('Context size: 400 tokens');
    expect(calls[0].messages[1].content).toContain('Rank the clubs by opportunity cost.');
    expect(calls[0].messages[1].content).not.toContain('Brief facts:');
    expect(d.tier).toBe('deep');
    expect(d.model).toBe('claude-opus-5');
    expect(d.effort).toBe('high');
    expect(d.overridden).toBe(false);
    expect(d.escalated).toBe(false);
    expect(d.complexity).toBe(3);
    expect(d.coveredByBrief).toBe(true);
    // Classifier JSON omits kind/confidence → defaults: kind 'other', confidence 1.
    expect(d.kind).toBe('other');
    expect(d.confidence).toBe(1);
    expect(d.reason).toBe('weighs trade-offs. A other question, complexity 3/3, against a 400-token brief.');
    expect(d.estCostUsd).toBe(costForModel('claude-opus-5', 400, 750));
  });

  it('includes the brief facts block in the classifier prompt', async () => {
    const { complete, calls } = fakeComplete([
      llmResult('{"complexity": 1, "covered": true, "reason": "fact lookup"}'),
    ]);
    await route(
      { question: 'When does it close?', contextTokens: 120, brief },
      { complete },
    );
    expect(calls[0].messages[1].content).toContain(
      'Brief facts:\n- Free Ventures applications close September 11.\n- The info session is September 3.',
    );
  });

  it('passes covered false through onto the decision', async () => {
    const { complete } = fakeComplete([
      llmResult('{"complexity": 1, "covered": false, "reason": "brief lacks it"}'),
    ]);
    const d = await route(
      { question: 'What about ML@B?', contextTokens: 120, brief },
      { complete },
    );
    expect(d.tier).toBe('quick');
    expect(d.coveredByBrief).toBe(false);
  });

  it('defaults covered to true when the classifier omits it', async () => {
    const { complete } = fakeComplete([
      llmResult('```json\n{"complexity": 1, "reason": "fact lookup"}\n```'),
    ]);
    const d = await route({ question: 'When does it close?', contextTokens: 120 }, { complete });
    expect(d.tier).toBe('quick');
    expect(d.complexity).toBe(1);
    expect(d.coveredByBrief).toBe(true);
  });

  it('defaults to thoughtful on unparseable classifier output', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { complete } = fakeComplete([llmResult('the model rambled with no json')]);
    const d = await route({ question: 'Anything', contextTokens: 400 }, { complete });
    expect(d.tier).toBe('thoughtful');
    expect(d.model).toBe('claude-sonnet-5');
    expect(d.effort).toBe('medium');
    expect(d.complexity).toBe(2);
    expect(d.overridden).toBe(false);
    expect(d.coveredByBrief).toBe(true);
    expect(d.reason).toContain('Classifier unclear');
  });

  it('treats out-of-range complexity as unparseable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { complete } = fakeComplete([llmResult('{"complexity": 5, "reason": "x"}')]);
    const d = await route({ question: 'Anything', contextTokens: 400 }, { complete });
    expect(d.complexity).toBe(2);
    expect(d.tier).toBe('thoughtful');
  });
});

describe('answerFailsSanityCheck', () => {
  it('fails punt phrases at any complexity', () => {
    expect(
      answerFailsSanityCheck("Based on the brief, I don't have enough context to say for certain."),
    ).toBe(true);
    expect(
      answerFailsSanityCheck(
        'There is not enough information in the compiled brief to rank these clubs.',
        1,
      ),
    ).toBe(true);
    expect(
      answerFailsSanityCheck('The compiled brief for this branch does not cover that.', 1),
    ).toBe(true);
  });

  it('fails answers under 40 chars only at complexity 2 and above', () => {
    expect(answerFailsSanityCheck('Yes.')).toBe(true);
    expect(answerFailsSanityCheck('   short   ', 3)).toBe(true);
    expect(answerFailsSanityCheck('September 11.', 1)).toBe(false);
  });

  it('passes a normal long answer', () => {
    expect(answerFailsSanityCheck(GOOD)).toBe(false);
  });
});

describe('completeWithEscalation', () => {
  it('makes one chat call and never widens when the first answer passes', async () => {
    const widen = vi.fn(() => ({ userPrompt: 'WIDENED', addedTokens: 60 }));
    const { complete, calls } = fakeComplete([
      llmResult(GOOD, {
        model: 'claude-sonnet-5',
        tier: 'thoughtful',
        estCostUsd: 0.25,
        inputTokens: 111,
        outputTokens: 57,
      }),
    ]);
    const out = await completeWithEscalation(
      {
        routing: routingFor('thoughtful', 'claude-sonnet-5', 'medium', { coveredByBrief: true }),
        systemPrompt: 'sys',
        userPrompt: 'user q',
        widen,
      },
      { complete },
    );
    expect(calls).toHaveLength(1);
    expect(widen).not.toHaveBeenCalled();
    expect(calls[0].tier).toBe('thoughtful');
    expect(calls[0].model).toBe('claude-sonnet-5');
    expect(calls[0].effort).toBe('medium');
    expect(calls[0].purpose).toBe('chat');
    expect(calls[0].messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user q' },
    ]);
    expect(out.text).toBe(GOOD);
    expect(out.routing.escalated).toBe(false);
    expect(out.routing.widened).toBeUndefined();
    expect(out.routing.tier).toBe('thoughtful');
    expect(out.routing.estCostUsd).toBe(0.25);
    expect(out.routing.servedBy).toBeUndefined();
    expect(out.inputTokens).toBe(111);
    expect(out.outputTokens).toBe(57);
  });

  it('pre-widens the first call when the classifier judged the brief insufficient', async () => {
    const widen = vi.fn(() => ({ userPrompt: 'WIDENED PROMPT', addedTokens: 60 }));
    const { complete, calls } = fakeComplete([
      llmResult(GOOD, { estCostUsd: 0.2, inputTokens: 160, outputTokens: 50 }),
    ]);
    const out = await completeWithEscalation(
      {
        routing: routingFor('quick', 'claude-haiku-4-5', 'low', { coveredByBrief: false }),
        systemPrompt: 'sys',
        userPrompt: 'user q',
        widen,
      },
      { complete },
    );
    expect(widen).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].messages[1].content).toBe('WIDENED PROMPT');
    expect(out.text).toBe(GOOD);
    expect(out.routing.widened).toBe(true);
    expect(out.routing.contextTokens).toBe(460);
    expect(out.routing.escalated).toBe(false);
    expect(out.routing.reason).toContain('Widened with parent turns');
    expect(out.routing.estCostUsd).toBe(0.2);
  });

  it('retries a punt on the SAME model with the widened prompt before touching the ladder', async () => {
    const widen = vi.fn(() => ({ userPrompt: 'WIDENED PROMPT', addedTokens: 80 }));
    const { complete, calls } = fakeComplete([
      llmResult(PUNT, { estCostUsd: 0.2, inputTokens: 100, outputTokens: 20 }),
      llmResult(GOOD, { estCostUsd: 0.3, inputTokens: 180, outputTokens: 60 }),
    ]);
    const out = await completeWithEscalation(
      {
        routing: routingFor('quick', 'claude-haiku-4-5', 'low'),
        systemPrompt: 'sys',
        userPrompt: 'user q',
        widen,
      },
      { complete },
    );
    expect(widen).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].messages[1].content).toBe('user q');
    expect(calls[1].messages[1].content).toBe('WIDENED PROMPT');
    expect(calls[1].model).toBe(calls[0].model);
    expect(calls[1].tier).toBe(calls[0].tier);
    expect(calls[1].effort).toBe(calls[0].effort);
    expect(out.text).toBe(GOOD);
    expect(out.routing.escalated).toBe(false);
    expect(out.routing.widened).toBe(true);
    expect(out.routing.contextTokens).toBe(480);
    expect(out.routing.estCostUsd).toBe(0.5);
    expect(out.inputTokens).toBe(280);
    expect(out.outputTokens).toBe(80);
  });

  it('upgrades the model after the widened retry still punts, summing every call', async () => {
    const widen = vi.fn(() => ({ userPrompt: 'WIDENED PROMPT', addedTokens: 60 }));
    const { complete, calls } = fakeComplete([
      llmResult(PUNT, { estCostUsd: 0.2, inputTokens: 100, outputTokens: 20 }),
      llmResult(PUNT, { estCostUsd: 0.3, inputTokens: 120, outputTokens: 30 }),
      llmResult(GOOD, {
        model: 'claude-sonnet-5',
        tier: 'thoughtful',
        estCostUsd: 0.5,
        inputTokens: 200,
        outputTokens: 80,
      }),
    ]);
    const out = await completeWithEscalation(
      {
        routing: routingFor('quick', 'claude-haiku-4-5', 'low'),
        systemPrompt: 'sys',
        userPrompt: 'user q',
        widen,
      },
      { complete },
    );
    expect(widen).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(3);
    expect(calls[2].tier).toBe('thoughtful');
    expect(calls[2].model).toBe('claude-sonnet-5');
    expect(calls[2].effort).toBe('medium');
    expect(calls[2].messages[1].content).toBe('WIDENED PROMPT');
    expect(calls.every((c) => c.purpose === 'chat')).toBe(true);
    expect(out.text).toBe(GOOD);
    expect(out.routing.escalated).toBe(true);
    expect(out.routing.widened).toBe(true);
    expect(out.routing.model).toBe('claude-sonnet-5');
    expect(out.routing.label).toBe('Sonnet 5 · Medium effort');
    expect(out.routing.reason).toContain('Escalated to Sonnet 5 · Medium effort');
    expect(out.routing.reason).toContain('failed the sanity check');
    expect(out.routing.estCostUsd).toBe(1);
    expect(out.inputTokens).toBe(420);
    expect(out.outputTokens).toBe(130);
  });

  it('escalates a punting quick answer onto the next tier when there is nothing to widen', async () => {
    const { complete, calls } = fakeComplete([
      llmResult(PUNT, { estCostUsd: 0.25, inputTokens: 100, outputTokens: 20 }),
      llmResult(GOOD, {
        model: 'claude-sonnet-5',
        tier: 'thoughtful',
        estCostUsd: 0.5,
        inputTokens: 120,
        outputTokens: 80,
      }),
    ]);
    const out = await completeWithEscalation(
      {
        routing: routingFor('quick', 'claude-haiku-4-5', 'low'),
        systemPrompt: 'sys',
        userPrompt: 'user q',
      },
      { complete },
    );
    expect(calls).toHaveLength(2);
    expect(calls[1].tier).toBe('thoughtful');
    expect(calls[1].model).toBe('claude-sonnet-5');
    expect(calls[1].effort).toBe('medium');
    expect(calls[1].messages).toEqual(calls[0].messages);
    expect(out.text).toBe(GOOD);
    expect(out.routing.escalated).toBe(true);
    expect(out.routing.widened).toBeUndefined();
    expect(out.routing.tier).toBe('thoughtful');
    expect(out.routing.model).toBe('claude-sonnet-5');
    expect(out.routing.estCostUsd).toBe(0.75);
    expect(out.inputTokens).toBe(220);
    expect(out.outputTokens).toBe(100);
  });

  it('escalates a punting deep answer on a non-ceiling model onto the ceiling model', async () => {
    const { complete, calls } = fakeComplete([
      llmResult(PUNT, { model: 'claude-opus-5', tier: 'deep' }),
      llmResult(GOOD, { model: CEILING_MODEL, tier: 'deep', estCostUsd: 0.5 }),
    ]);
    const out = await completeWithEscalation(
      {
        routing: routingFor('deep', 'claude-opus-5', 'high'),
        systemPrompt: 'sys',
        userPrompt: 'user q',
      },
      { complete },
    );
    expect(calls).toHaveLength(2);
    expect(calls[1].tier).toBe('deep');
    expect(calls[1].model).toBe(CEILING_MODEL);
    expect(calls[1].effort).toBe('high');
    expect(out.text).toBe(GOOD);
    expect(out.routing.escalated).toBe(true);
    expect(out.routing.tier).toBe('deep');
    expect(out.routing.model).toBe('claude-fable-5');
    expect(out.routing.label).toBe('Fable 5 · High effort');
    expect(out.routing.estCostUsd).toBe(0.75);
  });

  it('never upgrades an overridden routing: widened retry fails, last answer returned', async () => {
    const widen = vi.fn(() => ({ userPrompt: 'WIDENED PROMPT', addedTokens: 40 }));
    const { complete, calls } = fakeComplete([
      llmResult(PUNT, { estCostUsd: 0.2, inputTokens: 100, outputTokens: 20 }),
      llmResult(PUNT, { estCostUsd: 0.3, inputTokens: 120, outputTokens: 30 }),
    ]);
    const out = await completeWithEscalation(
      {
        routing: routingFor('quick', 'claude-haiku-4-5', 'low', { overridden: true }),
        systemPrompt: 'sys',
        userPrompt: 'user q',
        widen,
      },
      { complete },
    );
    expect(widen).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].model).toBe('claude-haiku-4-5');
    expect(calls[1].model).toBe('claude-haiku-4-5');
    expect(out.text).toBe(PUNT);
    expect(out.routing.escalated).toBe(false);
    expect(out.routing.widened).toBe(true);
    expect(out.routing.model).toBe('claude-haiku-4-5');
    expect(out.routing.estCostUsd).toBe(0.5);
    expect(out.inputTokens).toBe(220);
    expect(out.outputTokens).toBe(50);
  });

  it('never upgrades an overridden routing: no widen means one call, punt returned', async () => {
    const { complete, calls } = fakeComplete([
      llmResult(PUNT, { estCostUsd: 0.2, inputTokens: 100, outputTokens: 20 }),
    ]);
    const out = await completeWithEscalation(
      {
        routing: routingFor('thoughtful', 'claude-sonnet-5', 'medium', { overridden: true }),
        systemPrompt: 'sys',
        userPrompt: 'user q',
      },
      { complete },
    );
    expect(calls).toHaveLength(1);
    expect(out.text).toBe(PUNT);
    expect(out.routing.escalated).toBe(false);
    expect(out.routing.model).toBe('claude-sonnet-5');
  });

  it('returns the punting answer without a second call only at the ceiling model', async () => {
    const { complete, calls } = fakeComplete([
      llmResult(PUNT, {
        model: CEILING_MODEL,
        tier: 'deep',
        estCostUsd: 0.5,
        inputTokens: 90,
        outputTokens: 15,
      }),
    ]);
    const out = await completeWithEscalation(
      {
        routing: routingFor('deep', CEILING_MODEL, 'max'),
        systemPrompt: 'sys',
        userPrompt: 'user q',
      },
      { complete },
    );
    expect(calls).toHaveLength(1);
    expect(out.text).toBe(PUNT);
    expect(out.routing.escalated).toBe(false);
    expect(out.routing.model).toBe(CEILING_MODEL);
    expect(out.routing.estCostUsd).toBe(0.5);
    expect(out.inputTokens).toBe(90);
    expect(out.outputTokens).toBe(15);
  });
});
