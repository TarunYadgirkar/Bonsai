import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileBrief } from '../src/compiler';
import { complete } from '../src/llm';
import { setEngineLogger } from '../src/logger';

const ENV = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY', 'BONSAI_COMPILE_BASE_URL', 'BONSAI_COMPILE_MODEL'];
const saved: Record<string, string | undefined> = {};

function studentReply(content: string, status = 200) {
  const fn = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    new Response(
      status === 200
        ? JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 50, completion_tokens: 20 } })
        : 'down',
      { status },
    ),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

const COMPILE_PARAMS = {
  briefId: 'brief-1',
  branchId: 'b1',
  pathMarkdown: '**user:** Which club?\n\n**assistant:** Free Ventures closes September 11.',
  selection: 'Free Ventures',
  question: 'when is the deadline?',
  availableTokens: 400,
};

beforeEach(() => {
  for (const key of ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  setEngineLogger({ warn: () => {}, error: () => {} });
});

afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
});

afterAll(() => setEngineLogger(console));

describe('opt-in compile student', () => {
  it('is off unless both variables are set', async () => {
    process.env.BONSAI_COMPILE_BASE_URL = 'http://localhost:11434/v1';
    const fetchFn = studentReply('{}');
    const result = await complete({ tier: 'quick', purpose: 'compile', messages: [{ role: 'user', content: 'x' }] });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.mock).toBe(true);
  });

  it('compiles the brief when configured', async () => {
    process.env.BONSAI_COMPILE_BASE_URL = 'http://localhost:11434/v1/';
    process.env.BONSAI_COMPILE_MODEL = 'bonsai-distill-sft';
    const fetchFn = studentReply(
      JSON.stringify({ facts: ['Free Ventures applications close September 11.'], excludedNote: 'Other clubs.' }),
    );
    const { brief } = await compileBrief(COMPILE_PARAMS);
    expect(fetchFn.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
    expect(JSON.parse(String(fetchFn.mock.calls[0][1].body)).model).toBe('bonsai-distill-sft');
    expect(brief.facts).toEqual(['Free Ventures applications close September 11.']);
  });

  it('never answers chat, classify or merge calls', async () => {
    process.env.BONSAI_COMPILE_BASE_URL = 'http://localhost:11434/v1';
    process.env.BONSAI_COMPILE_MODEL = 'bonsai-distill-sft';
    const fetchFn = studentReply('nope');
    for (const purpose of ['chat', 'classify', 'merge'] as const) {
      await complete({ tier: 'quick', purpose, messages: [{ role: 'user', content: 'x' }] });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('falls back to the usual chain when the student is down', async () => {
    process.env.BONSAI_COMPILE_BASE_URL = 'http://localhost:11434/v1';
    process.env.BONSAI_COMPILE_MODEL = 'bonsai-distill-sft';
    studentReply('', 503);
    const result = await complete({ tier: 'quick', purpose: 'compile', messages: [{ role: 'user', content: 'x' }] });
    expect(result.mock).toBe(true);
  });
});
