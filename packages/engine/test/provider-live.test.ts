import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { providerComplete } from '../src/provider';
import { setEngineLogger } from '../src/logger';

/**
 * The mock-first degradation guarantee (AGENTS.md rule 8): with a live key set, `providerComplete`
 * returns a real result on success and `null` on every failure so the llm layer falls back to the
 * mock. Previously only `anthropicBody`'s param policy was covered — this stubs `fetch` to prove
 * the surrounding success/degradation paths. `anthropicBody` policy lives in provider.test.ts.
 */

const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};

const MESSAGES = [
  { role: 'system' as const, content: 'Answer briefly.' },
  { role: 'user' as const, content: 'When do applications close?' },
];

type FakeResponse = {
  ok: boolean;
  status?: number;
  json?: unknown;
  text?: string;
};

function fakeResponse(init: FakeResponse) {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    json: async () => init.json,
    text: async () => init.text ?? '',
  };
}

function stubFetch(response: FakeResponse) {
  const fn = vi.fn(async (_input: string, _init: RequestInit) => fakeResponse(response));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  for (const key of KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  // Keep the fallback warnings out of the test output while exercising the new logger seam.
  setEngineLogger({ warn: () => {}, error: () => {} });
});

afterEach(() => {
  for (const key of KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
});

afterAll(() => setEngineLogger(console));

describe('providerComplete — anthropic', () => {
  it('returns text, token usage, and servedBy on a 200 with usage', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    stubFetch({
      ok: true,
      json: {
        content: [{ type: 'text', text: 'Applications close on March 1.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 42, output_tokens: 11 },
      },
    });

    const result = await providerComplete({
      model: 'claude-sonnet-5',
      messages: MESSAGES,
      maxTokens: 300,
    });

    expect(result).toEqual({
      text: 'Applications close on March 1.',
      inputTokens: 42,
      outputTokens: 11,
      servedBy: 'claude-sonnet-5',
    });
  });

  it('returns null on a non-ok status (degrades to mock)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    stubFetch({ ok: false, status: 429, text: 'rate limited' });

    const result = await providerComplete({
      model: 'claude-sonnet-5',
      messages: MESSAGES,
      maxTokens: 300,
    });

    expect(result).toBeNull();
  });

  it('returns null when the response stops with reason "refusal"', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    stubFetch({
      ok: true,
      json: {
        content: [{ type: 'text', text: 'I can help with a partial...' }],
        stop_reason: 'refusal',
        usage: { input_tokens: 20, output_tokens: 5 },
      },
    });

    const result = await providerComplete({
      model: 'claude-fable-5',
      messages: MESSAGES,
      maxTokens: 300,
    });

    expect(result).toBeNull();
  });

  it('returns null when the content is empty', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    stubFetch({
      ok: true,
      json: {
        content: [],
        stop_reason: 'end_turn',
        usage: { input_tokens: 8, output_tokens: 0 },
      },
    });

    const result = await providerComplete({
      model: 'claude-sonnet-5',
      messages: MESSAGES,
      maxTokens: 300,
    });

    expect(result).toBeNull();
  });
});

describe('providerComplete — openai', () => {
  it('maps max_completion_tokens and reads choices[0].message.content', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    const fetchMock = stubFetch({
      ok: true,
      json: {
        choices: [{ message: { content: 'The deadline is March 1.' } }],
        usage: { prompt_tokens: 30, completion_tokens: 9 },
      },
    });

    const result = await providerComplete({
      model: 'claude-sonnet-5',
      messages: MESSAGES,
      maxTokens: 512,
    });

    expect(result).toEqual({
      text: 'The deadline is March 1.',
      inputTokens: 30,
      outputTokens: 9,
      servedBy: 'gpt-5.4',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.max_completion_tokens).toBe(512);
    expect(body.model).toBe('gpt-5.4');
    expect(body).not.toHaveProperty('max_tokens');
  });
});
