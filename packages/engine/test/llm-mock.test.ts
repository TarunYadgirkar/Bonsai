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

function compilerMessages(selection: string, question: string, transcript: string): LlmMessage[] {
  return [
    {
      role: 'system',
      content:
        'You compile minimal context briefs. Respond with JSON only: {"facts": string[], "excludedNote": string}.',
    },
    {
      role: 'user',
      content: [
        'User profile: Tarun — Berkeley freshman.',
        `Branch topic (highlighted text): ${selection}`,
        `Branch question: ${question}`,
        '',
        'Parent conversation:',
        transcript,
      ].join('\n'),
    },
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
    const parsed = JSON.parse(result.text) as {
      complexity: number;
      covered: boolean;
      reason: string;
    };

    expect([1, 2, 3]).toContain(parsed.complexity);
    expect(parsed.complexity).toBe(1);
    expect(parsed.covered).toBe(true);
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

  it('judges covered against the brief facts pasted into the classifier prompt', async () => {
    const classifierWithFacts = (facts: string[], question: string): LlmMessage[] => [
      {
        role: 'system',
        content:
          'Rate the question. Respond with JSON only: {"complexity": 1|2|3, "covered": true|false, "reason": "<8 words>"}.',
      },
      {
        role: 'user',
        content: [
          'Context size: 200 tokens.',
          'Brief facts:',
          ...facts.map((f) => `- ${f}`),
          `Question: ${question}`,
        ].join('\n'),
      },
    ];

    const covered = await complete({
      tier: 'quick',
      messages: classifierWithFacts(
        ['Free Ventures applications close September 11.'],
        'When do Free Ventures applications close?',
      ),
    });
    expect((JSON.parse(covered.text) as { covered: boolean }).covered).toBe(true);

    const uncovered = await complete({
      tier: 'quick',
      messages: classifierWithFacts(
        ['Blueprint builds software for nonprofits.'],
        'When do Free Ventures applications close?',
      ),
    });
    expect((JSON.parse(uncovered.text) as { covered: boolean }).covered).toBe(false);
  });

  it('emits a question kind inferred from surface cues', async () => {
    const classify = async (question: string) => {
      const result = await complete({
        tier: 'quick',
        purpose: 'classify',
        messages: classifierMessages(question, 200),
      });
      return JSON.parse(result.text) as { kind: string; confidence: number; complexity: number };
    };

    const cases: [string, string][] = [
      ['When do Free Ventures applications close?', 'lookup'],
      ['Compare ML@B and Blueprint on time commitment.', 'comparison'],
      ['Why is the education track so heavy?', 'synthesis'],
      ['Debug the function that breaks on import.', 'code'],
      ['Write a short poem about the bonsai garden.', 'creative'],
      [
        'Given my workload cap and my startup goals, weigh whether joining two clubs is sustainable this semester.',
        'reasoning',
      ],
    ];
    for (const [question, expected] of cases) {
      const parsed = await classify(question);
      expect(parsed.kind, question).toBe(expected);
      expect(parsed.confidence).toBeGreaterThanOrEqual(0);
      expect(parsed.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('is confident on a single clear cue and unsure on ambiguity or none', async () => {
    const classify = async (question: string) => {
      const result = await complete({
        tier: 'quick',
        purpose: 'classify',
        messages: classifierMessages(question, 200),
      });
      return JSON.parse(result.text) as { kind: string; confidence: number };
    };

    const clear = await classify('When do Free Ventures applications close?');
    expect(clear.confidence).toBeGreaterThanOrEqual(0.7);

    // "why" (synthesis) + "deadline" (lookup) + "compare" (comparison) all fire at once.
    const ambiguous = await classify('Why does the deadline compare so badly?');
    expect(ambiguous.kind).toBe('comparison');
    expect(ambiguous.confidence).toBeLessThan(0.5);

    const cueless = await classify('Thoughts on the current club plan?');
    expect(cueless.kind).toBe('other');
    expect(cueless.confidence).toBeLessThan(0.5);
    expect(clear.confidence).toBeGreaterThan(cueless.confidence);
  });

  it('answers compiler prompts with facts extracted from transcript sentences on the topic', async () => {
    const transcript = [
      'user: I am weighing which clubs to join at Berkeley this fall semester.',
      '',
      'assistant: Free Ventures is a student-run accelerator where you apply with your own startup. Free Ventures applications close September 11 with an info session on September 3. Blueprint does consulting for nonprofits and has a heavy time commitment.',
    ].join('\n');
    const result = await complete({
      tier: 'quick',
      messages: compilerMessages(
        'Free Ventures',
        'When do Free Ventures applications close?',
        transcript,
      ),
    });
    const parsed = JSON.parse(result.text) as { facts: string[]; excludedNote: string };

    expect(parsed.facts.length).toBeGreaterThan(0);
    expect(parsed.facts.every((f) => f.includes('Free Ventures'))).toBe(true);
    expect(parsed.facts[0]).toContain('September 11');
    expect(parsed.facts.some((f) => f.includes('Blueprint'))).toBe(false);
    expect(parsed.excludedNote).toContain('Free Ventures');
    expect(result.mock).toBe(true);
  });

  it('never injects the Berkeley fixture into an unrelated transcript with no salient match', async () => {
    const transcript = [
      'user: We are migrating the billing service off the legacy monolith next quarter.',
      '',
      'assistant: The cutover window is the first weekend of March, with a read-only freeze.',
    ].join('\n');
    // Selection + question share no vocabulary with the transcript, so nothing ranks and the
    // fallback path runs — it must carry the transcript forward, not the Berkeley fixture.
    const result = await complete({
      tier: 'quick',
      messages: compilerMessages('pricing tiers', 'what does the vendor SLA say?', transcript),
    });
    const parsed = JSON.parse(result.text) as { facts: string[]; excludedNote: string };
    const blob = parsed.facts.join(' ');
    expect(blob).not.toMatch(/Free Ventures|Berkeley|ML@B|Hertz/);
    expect(blob).toContain('billing service');
  });

  it('ranks a rare-term sentence above common-word sentences that match more query terms', async () => {
    // Five noise sentences each match TWO common terms ("clubs", "offer"); the answer sentence
    // matches only ONE term ("stipend") that appears nowhere else. A raw overlap count ranks
    // the noise higher; inverse-sentence-frequency rarity must put the stipend sentence first.
    const transcript = [
      'assistant: Berkeley clubs offer recruiting events during the first weeks of the semester.',
      'assistant: Most clubs offer workshops that help freshmen meet upperclassmen early.',
      'assistant: Consulting clubs offer case interview practice on weekday evenings.',
      'assistant: Social clubs offer mixers and game nights on most weekends.',
      'assistant: Design clubs offer portfolio reviews at the start of the term.',
      'assistant: The engineering society pays each member a stipend of 500 dollars.',
    ].join('\n');
    const result = await complete({
      tier: 'quick',
      purpose: 'compile',
      messages: compilerMessages('funding', 'How big a stipend do clubs offer?', transcript),
    });
    const parsed = JSON.parse(result.text) as { facts: string[]; excludedNote: string };

    expect(parsed.facts[0]).toContain('stipend of 500 dollars');
    expect(typeof parsed.excludedNote).toBe('string');
  });

  it('boosts a later transcript sentence over an otherwise equal earlier one', async () => {
    const transcript = [
      'assistant: The studio rent was quoted at 2000 dollars monthly during the tour.',
      'assistant: The studio rent was requoted at 2100 dollars monthly after the follow-up call.',
    ].join('\n');
    const result = await complete({
      tier: 'quick',
      purpose: 'compile',
      messages: compilerMessages('studio rent', 'What is the studio rent now?', transcript),
    });
    const parsed = JSON.parse(result.text) as { facts: string[] };

    expect(parsed.facts[0]).toContain('2100');
  });

  it('scores a user constraint above a later user question with the same term matches', async () => {
    const transcript = [
      'user: I want at most two clubs to fit this semester.',
      'user: Which clubs would look impressive on resumes this semester?',
    ].join('\n');
    const result = await complete({
      tier: 'quick',
      purpose: 'compile',
      messages: compilerMessages('club load', 'Which clubs suit this semester?', transcript),
    });
    const parsed = JSON.parse(result.text) as { facts: string[] };

    expect(parsed.facts[0]).toContain('at most two clubs');
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

  it('answers a root question extractively from the transcript when there is no brief', async () => {
    const transcript = [
      'User: We are planning the fall docs migration for the platform team.',
      'Assistant: The docs migration freeze begins October 2 and lasts two weeks for review.',
    ].join('\n');
    const result = await complete({
      tier: 'quick',
      messages: [
        { role: 'system', content: 'Answer from the conversation.' },
        { role: 'user', content: `${transcript}\n---\nWhen does the docs migration freeze begin?` },
      ],
    });
    expect(result.text).toBe(
      'The docs migration freeze begins October 2 and lasts two weeks for review.',
    );
  });

  it('punts with a context message, not a brief message, on an uncovered root question', async () => {
    const transcript = 'User: We are planning the fall docs migration for the platform team.';
    const result = await complete({
      tier: 'quick',
      messages: [
        { role: 'system', content: 'Answer from the conversation.' },
        { role: 'user', content: `${transcript}\n---\nWhat is the annual security budget?` },
      ],
    });
    expect(result.text).toMatch(/context here does not cover/);
    expect(result.text).not.toMatch(/compiled brief/);
  });

  it('uses turns pulled from the parent thread once the ladder has widened a branch', async () => {
    const prompt = [
      '## Relevant facts',
      '- Blueprint builds software for nonprofits and needs around ten hours weekly.',
      '',
      '## Pulled from the parent thread (brief was insufficient)',
      'Assistant: The Free Ventures info session is September 3 at the Haas courtyard venue.',
      '---',
      'Where is the Free Ventures info session held?',
    ].join('\n');
    const result = await complete({
      tier: 'quick',
      messages: [{ role: 'user', content: prompt }],
    });
    expect(result.text).toBe(
      'The Free Ventures info session is September 3 at the Haas courtyard venue.',
    );
  });

  it('dispatches on purpose merge even when the prompt looks like a chat answer', async () => {
    const conclusion =
      'Free Ventures applications close September 11 so draft the application early.';
    const result = await complete({
      tier: 'quick',
      purpose: 'merge',
      messages: [
        { role: 'system', content: 'Answer using only the brief.' },
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
  });

  it('dispatches on purpose chat even when the prompt looks like classifier JSON', async () => {
    const result = await complete({
      tier: 'quick',
      purpose: 'chat',
      messages: [
        { role: 'system', content: 'Respond with JSON only: {"complexity": 1|2|3}.' },
        {
          role: 'user',
          content: [
            'Context size: 200 tokens.',
            '## Relevant facts',
            '- Blueprint builds software for nonprofits and needs around ten hours weekly.',
            '',
            '---',
            'How many hours does Blueprint need weekly?',
          ].join('\n'),
        },
      ],
    });
    expect(result.text).toBe(
      'Blueprint builds software for nonprofits and needs around ten hours weekly.',
    );
    expect(result.text).not.toContain('"complexity"');
  });
});
