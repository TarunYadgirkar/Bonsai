import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileBrief, type CompileParams } from '../src/compiler';
import { estimateTokens, prunedPct } from '../src/tokens';
import type { UserProfile } from '../src/types';
import { fakeComplete, llmResult } from './helpers';

const profile: UserProfile = {
  name: 'Tarun',
  context: 'Berkeley freshman.',
  goals: ['ship Bonsai', 'join two clubs'],
};

const pathMarkdown = [
  '## Conversation',
  'user: Which clubs should I join this fall?',
  '',
  'assistant: Free Ventures applications close September 11.',
].join('\n');

const baseParams: CompileParams = {
  briefId: 'brief-1',
  branchId: 'b1',
  pathMarkdown,
  profile,
  selection: 'Free Ventures',
  question: 'When do applications close?',
  availableTokens: 4000,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('compileBrief', () => {
  it('caps facts at 8 and renders selection, facts, and question into the markdown', async () => {
    const facts = Array.from({ length: 10 }, (_, i) => `Fact ${i + 1} stands alone.`);
    const { complete } = fakeComplete([
      llmResult(JSON.stringify({ facts, excludedNote: 'Excluded: everything else.' })),
    ]);
    const { brief } = await compileBrief(baseParams, { complete });

    expect(brief.facts).toEqual(facts.slice(0, 8));
    expect(brief.excludedNote).toBe('Excluded: everything else.');
    expect(brief.markdown).toContain('# Branch brief — Free Ventures');
    expect(brief.markdown).toContain('**User:** Tarun — Berkeley freshman.');
    expect(brief.markdown).toContain('## Relevant facts');
    expect(brief.markdown).toContain('- Fact 8 stands alone.');
    expect(brief.markdown).not.toContain('Fact 9');
    expect(brief.markdown).toContain('## Question\nWhen do applications close?');
    expect(brief.id).toBe('brief-1');
    expect(brief.branchId).toBe('b1');
    expect(brief.selection).toBe('Free Ventures');
    expect(brief.availableTokens).toBe(4000);
    expect(brief.briefTokens).toBe(estimateTokens(brief.markdown));
    expect(brief.prunedPct).toBe(prunedPct(4000, brief.briefTokens));
  });

  it('trims facts from the tail until the markdown fits the token budget', async () => {
    const facts = Array.from(
      { length: 8 },
      (_, i) => `Fact ${i + 1} ${'lorem '.repeat(20)}stands alone in full.`,
    );
    const { complete } = fakeComplete([
      llmResult(JSON.stringify({ facts, excludedNote: 'Excluded: everything else.' })),
    ]);
    const { brief } = await compileBrief({ ...baseParams, budgetTokens: 150 }, { complete });

    expect(brief.facts.length).toBeGreaterThanOrEqual(1);
    expect(brief.facts.length).toBeLessThan(8);
    expect(brief.facts).toEqual(facts.slice(0, brief.facts.length));
    expect(estimateTokens(brief.markdown)).toBeLessThanOrEqual(150);
    expect(brief.briefTokens).toBe(estimateTokens(brief.markdown));
  });

  it('never trims below one fact even when the budget is unreachable', async () => {
    const facts = Array.from(
      { length: 5 },
      (_, i) => `Fact ${i + 1} ${'lorem '.repeat(20)}stands alone in full.`,
    );
    const { complete } = fakeComplete([
      llmResult(JSON.stringify({ facts, excludedNote: 'Excluded: everything else.' })),
    ]);
    const { brief } = await compileBrief({ ...baseParams, budgetTokens: 1 }, { complete });

    expect(brief.facts).toEqual([facts[0]]);
    expect(estimateTokens(brief.markdown)).toBeGreaterThan(1);
  });

  it('carries anchorMessageId onto the brief and omits it when absent', async () => {
    const { complete } = fakeComplete([
      llmResult(JSON.stringify({ facts: ['A fact.'], excludedNote: 'Excluded: x.' })),
      llmResult(JSON.stringify({ facts: ['A fact.'], excludedNote: 'Excluded: x.' })),
    ]);
    const anchored = await compileBrief({ ...baseParams, anchorMessageId: 'p2' }, { complete });
    const unanchored = await compileBrief(baseParams, { complete });

    expect(anchored.brief.anchorMessageId).toBe('p2');
    expect(unanchored.brief.anchorMessageId).toBeUndefined();
    expect('anchorMessageId' in unanchored.brief).toBe(false);
  });

  it('reports usage straight off the complete result', async () => {
    const { complete } = fakeComplete([
      llmResult(JSON.stringify({ facts: ['A fact.'], excludedNote: 'Excluded: x.' }), {
        inputTokens: 321,
        outputTokens: 87,
        estCostUsd: 0.000756,
        model: 'claude-haiku-4-5',
        mock: false,
        servedBy: 'claude-haiku-4-5-20251001',
      }),
    ]);
    const { usage } = await compileBrief(baseParams, { complete });

    expect(usage).toEqual({
      inputTokens: 321,
      outputTokens: 87,
      estCostUsd: 0.000756,
      model: 'claude-haiku-4-5',
      mock: false,
      servedBy: 'claude-haiku-4-5-20251001',
    });
  });

  it('omits servedBy from usage on mock results', async () => {
    const { complete } = fakeComplete([
      llmResult(JSON.stringify({ facts: ['A fact.'], excludedNote: 'Excluded: x.' })),
    ]);
    const { usage } = await compileBrief(baseParams, { complete });

    expect(usage.mock).toBe(true);
    expect(usage.servedBy).toBeUndefined();
    expect('servedBy' in usage).toBe(false);
  });

  it('falls back to a single topic fact on unparseable output', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { complete } = fakeComplete([llmResult('the compiler rambled, no json')]);
    const { brief } = await compileBrief(baseParams, { complete });

    expect(brief.facts).toEqual(['Topic in focus: Free Ventures.']);
    expect(brief.excludedNote).toBe(
      'Excluded: the rest of the parent conversation (compiler fallback).',
    );
    expect(brief.markdown).toContain('- Topic in focus: Free Ventures.');
  });

  it('treats an empty facts array as unparseable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { complete } = fakeComplete([
      llmResult('{"facts": [], "excludedNote": "kept nothing"}'),
    ]);
    const { brief } = await compileBrief(baseParams, { complete });

    expect(brief.facts).toEqual(['Topic in focus: Free Ventures.']);
    expect(brief.excludedNote).toBe(
      'Excluded: the rest of the parent conversation (compiler fallback).',
    );
  });

  it('prompts with purpose compile, the profile line, and the path markdown', async () => {
    const { complete, calls } = fakeComplete([
      llmResult(JSON.stringify({ facts: ['A fact.'], excludedNote: 'Excluded: x.' })),
    ]);
    await compileBrief(baseParams, { complete });

    expect(calls).toHaveLength(1);
    expect(calls[0].tier).toBe('quick');
    expect(calls[0].purpose).toBe('compile');
    expect(calls[0].maxTokens).toBe(600);
    const [system, user] = calls[0].messages;
    expect(system.role).toBe('system');
    expect(system.content).toContain('compile minimal context');
    expect(system.content).toContain('ONE fact the question most depends on first');
    expect(system.content).toContain('smaller model could not infer without them');
    expect(system.content).toContain('{"facts": string[], "excludedNote": string}');
    expect(user.role).toBe('user');
    expect(user.content).toContain(
      'User profile: Tarun — Berkeley freshman. Goals: ship Bonsai; join two clubs.',
    );
    expect(user.content).toContain('Branch topic (highlighted text): Free Ventures');
    expect(user.content).toContain('Branch question: When do applications close?');
    expect(user.content).toContain(`Parent conversation:\n${pathMarkdown}`);
  });
  it('pins the inherited anchor fact first so the chain entity survives composition', async () => {
    const facts = ['It closes September 11.', 'Late submissions are not accepted.'];
    const { complete } = fakeComplete([
      llmResult(JSON.stringify({ facts, excludedNote: 'Excluded: everything else.' })),
    ]);
    const { brief } = await compileBrief(
      { ...baseParams, anchorFact: 'Free Ventures applications close September 11.' },
      { complete },
    );

    expect(brief.facts[0]).toBe('Free Ventures applications close September 11.');
    expect(brief.facts).toHaveLength(3);
  });

  it('does not duplicate the anchor fact when the compiler already carried it through', async () => {
    const facts = ['Free Ventures applications close September 11.', 'Info session September 3.'];
    const { complete } = fakeComplete([
      llmResult(JSON.stringify({ facts, excludedNote: 'Excluded: everything else.' })),
    ]);
    const { brief } = await compileBrief(
      { ...baseParams, anchorFact: 'Free Ventures applications close September 11.' },
      { complete },
    );

    expect(brief.facts).toEqual(facts);
  });
  it('skips the pin when the compiler carried the anchor through rephrased', async () => {
    const facts = ['Free Ventures closes September 11.', 'Late submissions are not accepted.'];
    const { complete } = fakeComplete([
      llmResult(JSON.stringify({ facts, excludedNote: 'Excluded: everything else.' })),
    ]);
    const { brief } = await compileBrief(
      { ...baseParams, anchorFact: 'Free Ventures applications close September 11.' },
      { complete },
    );

    expect(brief.facts).toEqual(facts);
  });
});
