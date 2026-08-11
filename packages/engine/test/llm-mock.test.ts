import { beforeEach, describe, expect, it } from 'vitest';
import { complete, type LlmMessage } from '../src/llm';
import { costForModel } from '../src/models';
import { estimateTokens } from '../src/tokens';

const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY'] as const;

beforeEach(() => {
  for (const key of KEYS) delete process.env[key];
});

function classifierMessages(question: string, contextTokens: number): LlmMessage[] {
  return [
    {
      role: 'system',
      content:
        'Rate the question. Respond with JSON only: {"complexity": 1|2|3, "reason": "<8 words>"}.',
    },
    { role: 'user', content: `Context size: ${contextTokens} tokens.\nQuestion: ${question}` },
  ];
}

const PUNT_SENTENCE =
  'The compiled brief for this branch does not cover that. Ask to pull more of the parent thread in, or branch again from the part of the conversation that does.';

describe('mock provider path', () => {
  it('runs with no provider keys set', () => {
    for (const key of KEYS) expect(process.env[key]).toBeUndefined();
  });

  it('answers classifier prompts with JSON complexity 1-3 and realistic token math', async () => {
    const messages = classifierMessages('What is the application deadline?', 120);
    const result = await complete({ tier: 'quick', messages });
    const parsed = JSON.parse(result.text) as { complexity: number; reason: string };

    expect([1, 2, 3]).toContain(parsed.complexity);
    expect(parsed.complexity).toBe(1);
    expect(typeof parsed.reason).toBe('string');
    expect(result.mock).toBe(true);
    expect(result.servedBy).toBeUndefined();
    expect(result.model).toBe('claude-haiku-4-5');
    expect(result.tier).toBe('quick');
    expect(result.inputTokens).toBe(
      messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0),
    );
    expect(result.outputTokens).toBe(estimateTokens(result.text));
    expect(result.estCostUsd).toBe(
      costForModel('claude-haiku-4-5', result.inputTokens, result.outputTokens),
    );
    expect(result.estCostUsd).toBeGreaterThan(0);
  });

  it('rates ranking questions complexity 3 and mid-length questions complexity 2', async () => {
    const ranking = await complete({
      tier: 'quick',
      messages: classifierMessages('Rank the top 3 clubs by opportunity cost for my week.', 800),
    });
    expect((JSON.parse(ranking.text) as { complexity: number }).complexity).toBe(3);

    const medium = await complete({
      tier: 'quick',
      messages: classifierMessages(
        'How should I think about balancing club applications with problem sets during my first semester at Berkeley overall?',
        800,
      ),
    });
    expect((JSON.parse(medium.text) as { complexity: number }).complexity).toBe(2);
  });

  it('answers compiler prompts with facts extracted from transcript sentences on the topic', async () => {
    const transcript = [
      'user: I am weighing which clubs to join at Berkeley this fall semester.',
      '',
      'assistant: Free Ventures is a student-run accelerator where you apply with your own startup. Free Ventures applications close September 11 with an info session on September 3. Blueprint does consulting for nonprofits and has a heavy time commitment.',
    ].join('\n');
    const messages: LlmMessage[] = [
      {
        role: 'system',
        content:
          'You compile minimal context briefs. Respond with JSON only: {"facts": string[], "excludedNote": string}.',
      },
      {
        role: 'user',
        content: [
          'User profile: Tarun — Berkeley freshman.',
          'Branch topic (highlighted text): Free Ventures',
          'Branch question: When do Free Ventures applications close?',
          '',
          'Parent conversation:',
          transcript,
        ].join('\n'),
      },
    ];
    const result = await complete({ tier: 'quick', messages });
    const parsed = JSON.parse(result.text) as { facts: string[]; excludedNote: string };

    expect(parsed.facts.length).toBeGreaterThan(0);
    expect(parsed.facts.every((f) => f.includes('Free Ventures'))).toBe(true);
    expect(parsed.facts[0]).toContain('September 11');
    expect(parsed.facts.some((f) => f.includes('Blueprint'))).toBe(false);
    expect(parsed.excludedNote).toContain('Free Ventures');
    expect(result.mock).toBe(true);
  });

  it('distills a branch to one line of at most 20 words', async () => {
    const conclusion =
      'Free Ventures applications close September 11 so a draft must be ready before the info session.';
    const result = await complete({
      tier: 'quick',
      messages: [
        { role: 'system', content: 'Distill this branch into its single durable conclusion.' },
        {
          role: 'user',
          content: [
            'Branch topic: Free Ventures',
            '',
            'user: Should I apply this cycle even though recruiting is busy?',
            '',
            `assistant: ${conclusion}`,
          ].join('\n'),
        },
      ],
    });
    expect(result.text).toBe(conclusion);
    expect(result.text.includes('\n')).toBe(false);
    expect(result.text.split(/\s+/).length).toBeLessThanOrEqual(20);
  });

  it('ellipsises a distilled conclusion longer than 20 words', async () => {
    const longConclusion =
      'Free Ventures applications close September 11 and the info session on September 3 means the draft, the budget slide, and the team slide must all be polished well before recruiting season begins.';
    const result = await complete({
      tier: 'quick',
      messages: [
        { role: 'system', content: 'Distill this branch into its single durable conclusion.' },
        {
          role: 'user',
          content: ['Branch topic: Free Ventures', '', `assistant: ${longConclusion}`].join('\n'),
        },
      ],
    });
    expect(result.text.endsWith('…')).toBe(true);
    expect(result.text.split(/\s+/)).toHaveLength(20);
    expect(result.text.startsWith('Free Ventures applications close')).toBe(true);
  });

  it('answers extractively from the brief facts on the quick tier', async () => {
    const brief = [
      '# Branch brief — Blueprint',
      '',
      '## Relevant facts',
      '- Blueprint builds software for nonprofits and needs around ten hours weekly.',
      '- Free Ventures applications close September 11.',
      '',
      '## Question',
      'How many hours does Blueprint need weekly?',
    ].join('\n');
    const result = await complete({
      tier: 'quick',
      messages: [
        { role: 'system', content: 'Answer using only the brief.' },
        { role: 'user', content: `${brief}\n---\nHow many hours does Blueprint need weekly?` },
      ],
    });
    expect(result.text).toBe(
      'Blueprint builds software for nonprofits and needs around ten hours weekly.',
    );
    expect(result.mock).toBe(true);
  });

  it('punts honestly when no brief fact matches the question', async () => {
    const brief = [
      '## Relevant facts',
      '- Blueprint builds software for nonprofits and needs around ten hours weekly.',
    ].join('\n');
    const result = await complete({
      tier: 'quick',
      messages: [
        { role: 'system', content: 'Answer using only the brief.' },
        { role: 'user', content: `${brief}\n---\nWhat color is the sky painted at dusk?` },
      ],
    });
    expect(result.text).toBe(PUNT_SENTENCE);
  });
});
