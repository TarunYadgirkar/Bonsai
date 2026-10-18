import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { providerComplete, providerCompleteStream } from '../src/provider';
import { setEngineLogger } from '../src/logger';
import { completeWithEscalation } from '../src/router';
import { fakeComplete, llmResult } from './helpers';

const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};
const MESSAGES = [{ role: 'user' as const, content: 'When do applications close?' }];

interface Reply {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
  sse?: string;
  /** Simulated wall time the upstream takes before it answers. */
  takesMs?: number;
}

const anthropicOk = (text: string): Reply => ({
  status: 200,
  json: { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 9, output_tokens: 4 } },
});

function sseBody(text: string): string {
  return [
    `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 9 } } })}`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}`,
    `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } })}`,
    '',
  ].join('\n\n');
}

function toResponse(reply: Reply): Response {
  const body = reply.sse ?? (reply.json === undefined ? 'upstream error' : JSON.stringify(reply.json));
  return new Response(body, { status: reply.status, headers: reply.headers });
}

function stubFetch(replies: Reply[]) {
  const queue = [...replies];
  const fn = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => {
    const reply = queue.shift();
    if (!reply) throw new Error('unexpected extra fetch');
    if (reply.takesMs) vi.setSystemTime(Date.now() + reply.takesMs);
    return toResponse(reply);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const sentModels = (fn: ReturnType<typeof stubFetch>) =>
  fn.mock.calls.map(([, init]) => JSON.parse(String(init.body)).model as string);

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  for (const key of KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  setEngineLogger({ warn: () => {}, error: () => {} });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  for (const key of KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

afterAll(() => setEngineLogger(console));

describe('provider retries', () => {
  it('retries a 503 on the same upstream and answers', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchFn = stubFetch([{ status: 503 }, anthropicOk('March 1.')]);
    const result = await settle(providerComplete({ model: 'claude-sonnet-5-5', messages: MESSAGES, maxTokens: 300 }));
    expect(result?.text).toBe('March 1.');
    expect(result?.servedBy).toBe('claude-sonnet-5-5');
    expect(result).not.toHaveProperty('fellBackFrom');
    expect(sentModels(fetchFn)).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5']);
  });

  it('gives up after two retries of an overloaded upstream', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchFn = stubFetch([{ status: 529 }, { status: 529 }, { status: 529 }]);
    const result = await settle(providerComplete({ model: 'claude-sonnet-5-5', messages: MESSAGES, maxTokens: 300 }));
    expect(result).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('honours a short Retry-After on a 429', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchFn = stubFetch([{ status: 429, headers: { 'retry-after': '2' } }, anthropicOk('March 1.')]);
    const result = await settle(providerComplete({ model: 'claude-opus-5-5', messages: MESSAGES, maxTokens: 300 }));
    expect(result?.servedBy).toBe('claude-opus-5-5');
    expect(sentModels(fetchFn)).toEqual(['claude-opus-5-5', 'claude-opus-5-5']);
  });

  it('never retries a 400', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchFn = stubFetch([{ status: 400 }]);
    const result = await settle(providerComplete({ model: 'claude-sonnet-5-5', messages: MESSAGES, maxTokens: 300 }));
    expect(result).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('skips a retry the time budget cannot fit', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    // Low effort has a 30s budget; a 503 after 27s leaves no room for a 1.5s wait plus an attempt.
    const fetchFn = stubFetch([{ status: 503, takesMs: 27_000 }]);
    const result = await settle(
      providerComplete({ model: 'claude-haiku-5-5', messages: MESSAGES, maxTokens: 300, effort: 'low' }),
    );
    expect(result).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('propagates a caller abort during the backoff wait', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    stubFetch([{ status: 503 }, anthropicOk('never')]);
    const controller = new AbortController();
    const pending = providerComplete({
      model: 'claude-sonnet-5-5',
      messages: MESSAGES,
      maxTokens: 300,
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await assertion;
  });
});

describe('provider step-down', () => {
  it('steps a quota 429 down one rung and records what refused', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchFn = stubFetch([{ status: 429 }, anthropicOk('March 1.')]);
    const result = await settle(providerComplete({ model: 'claude-opus-5-5', messages: MESSAGES, maxTokens: 300 }));
    expect(result).toMatchObject({ servedBy: 'claude-sonnet-5-5', fellBackFrom: 'claude-opus-5-5' });
    expect(sentModels(fetchFn)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5']);
  });

  it('treats a long Retry-After as a quota', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchFn = stubFetch([{ status: 429, headers: { 'retry-after': '60' } }, anthropicOk('March 1.')]);
    await settle(providerComplete({ model: 'claude-sonnet-5-5', messages: MESSAGES, maxTokens: 300 }));
    expect(sentModels(fetchFn)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
  });

  it('steps down at most once', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchFn = stubFetch([{ status: 404 }, { status: 404 }]);
    const result = await settle(providerComplete({ model: 'claude-fable-5-1', messages: MESSAGES, maxTokens: 300 }));
    expect(result).toBeNull();
    expect(sentModels(fetchFn)).toEqual(['claude-fable-5-1', 'claude-opus-5-5']);
  });

  it('has nowhere to go below the quick model', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchFn = stubFetch([{ status: 404 }]);
    const result = await settle(providerComplete({ model: 'claude-haiku-5-5', messages: MESSAGES, maxTokens: 300 }));
    expect(result).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('skips rungs that share an upstream', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    // On OpenAI the ceiling and deep rungs are both gpt-5.5, so a refusal there lands on gpt-5.4.
    const fetchFn = stubFetch([
      { status: 404 },
      { status: 200, json: { choices: [{ message: { content: 'March 1.' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } } },
    ]);
    const result = await settle(providerComplete({ model: 'claude-fable-5-1', messages: MESSAGES, maxTokens: 300 }));
    expect(sentModels(fetchFn)).toEqual(['gpt-5.5', 'gpt-5.4']);
    expect(result).toMatchObject({ servedBy: 'gpt-5.4', fellBackFrom: 'gpt-5.5' });
  });
});

describe('streaming resilience', () => {
  it('retries a 503 before the first delta without duplicating text', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    stubFetch([{ status: 503 }, { status: 200, sse: sseBody('March 1.') }]);
    const deltas: string[] = [];
    const result = await settle(
      providerCompleteStream({ model: 'claude-sonnet-5-5', messages: MESSAGES, maxTokens: 300 }, (d) => deltas.push(d)),
    );
    expect(deltas).toEqual(['March 1.']);
    expect(result?.text).toBe('March 1.');
  });
});

describe('fellBackFrom on the routing decision', () => {
  it('carries the refused upstream and says so in the reason', async () => {
    const answer = 'Free Ventures applications close September 11, with an info session on September 3.';
    const { complete } = fakeComplete([
      llmResult(answer, { servedBy: 'claude-sonnet-5-5', fellBackFrom: 'claude-opus-5-5' }),
    ]);
    const out = await completeWithEscalation(
      {
        routing: {
          tier: 'deep',
          model: 'claude-opus-5-5',
          effort: 'high',
          effortNote: 'multi-step reasoning',
          contextTokens: 100,
          estCostUsd: 0,
          reason: 'Weighs trade-offs.',
          complexity: 3,
          escalated: false,
          overridden: false,
        },
        systemPrompt: 'sys',
        userPrompt: 'q',
      },
      { complete },
    );
    expect(out.routing.fellBackFrom).toBe('claude-opus-5-5');
    expect(out.routing.servedBy).toBe('claude-sonnet-5-5');
    expect(out.routing.reason).toBe(
      'Weighs trade-offs. claude-opus-5-5 was unavailable, so claude-sonnet-5-5 answered.',
    );
  });
});
