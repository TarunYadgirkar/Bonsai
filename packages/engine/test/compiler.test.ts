import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileBrief, type CompileParams } from '../src/compiler';
import { estimateTokens, prunedPct } from '../src/tokens';
import type { Message, UserProfile } from '../src/types';
import { fakeComplete, llmResult } from './helpers';

const profile: UserProfile = {
  name: 'Tarun',
  context: 'Berkeley freshman.',
  goals: ['ship Bonsai', 'join two clubs'],
};

const parentMessages: Message[] = [
  { id: 'p1', role: 'user', content: 'Which clubs should I join this fall?' },
  { id: 'p2', role: 'assistant', content: 'Free Ventures applications close September 11.' },
];

const baseParams: CompileParams = {
  briefId: 'brief-1',
  branchId: 'b1',
  parentMessages,
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
    const brief = await compileBrief(baseParams, { complete });

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

  it('falls back to a single topic fact on unparseable output', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { complete } = fakeComplete([llmResult('the compiler rambled, no json')]);
    const brief = await compileBrief(baseParams, { complete });

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
    const brief = await compileBrief(baseParams, { complete });

    expect(brief.facts).toEqual(['Topic in focus: Free Ventures.']);
    expect(brief.excludedNote).toBe(
      'Excluded: the rest of the parent conversation (compiler fallback).',
    );
  });

  it('prompts with the profile line, selection, question, and full parent transcript', async () => {
    const { complete, calls } = fakeComplete([
      llmResult(JSON.stringify({ facts: ['A fact.'], excludedNote: 'Excluded: x.' })),
    ]);
    await compileBrief(baseParams, { complete });

    expect(calls).toHaveLength(1);
    expect(calls[0].tier).toBe('quick');
    expect(calls[0].maxTokens).toBe(600);
    const [system, user] = calls[0].messages;
    expect(system.role).toBe('system');
    expect(system.content).toContain('compile minimal context');
    expect(user.role).toBe('user');
    expect(user.content).toContain(
      'User profile: Tarun — Berkeley freshman. Goals: ship Bonsai; join two clubs.',
    );
    expect(user.content).toContain('Branch topic (highlighted text): Free Ventures');
    expect(user.content).toContain('Branch question: When do applications close?');
    expect(user.content).toContain(
      'Parent conversation:\nuser: Which clubs should I join this fall?\n\nassistant: Free Ventures applications close September 11.',
    );
  });
});
