import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { costForServedBy, isPricedServedBy } from '../src/models';
import { geminiBody, providerComplete, providerName } from '../src/provider';
import { setEngineLogger } from '../src/logger';

const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY'] as const;
const saved: Record<string, string | undefined> = {};
const MESSAGES = [
  { role: 'system' as const, content: 'Answer briefly.' },
  { role: 'user' as const, content: 'When do applications close?' },
  { role: 'assistant' as const, content: 'Which program?' },
  { role: 'user' as const, content: 'Free Ventures.' },
];

function stubFetch(...replies: { status: number; json?: unknown }[]) {
  const queue = [...replies];
  const fn = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => {
    const reply = queue.shift()!;
    return new Response(reply.json === undefined ? 'error' : JSON.stringify(reply.json), { status: reply.status });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const answer = (finishReason = 'STOP') => ({
  status: 200,
  json: {
    candidates: [
      {
        content: { parts: [{ text: 'weighing the trunk', thought: true }, { text: 'September 11.' }] },
        finishReason,
      },
    ],
    usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 5, thoughtsTokenCount: 30 },
  },
});

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.GEMINI_API_KEY = 'gm-test';
  setEngineLogger({ warn: () => {}, error: () => {} });
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
});

afterAll(() => setEngineLogger(console));

describe('gemini provider', () => {
  it('is picked only when no other key is set', () => {
    expect(providerName()).toBe('gemini');
    process.env.XAI_API_KEY = 'xai';
    expect(providerName()).toBe('xai');
  });

  it('maps system, turns and effort into a generateContent body', () => {
    const body = geminiBody({ messages: MESSAGES, maxTokens: 300, effort: 'max' });
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'Answer briefly.' }] });
    expect((body.contents as { role: string }[]).map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(body.generationConfig).toEqual({ maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: 'high' } });
    expect(geminiBody({ messages: MESSAGES, maxTokens: 300, effort: 'low' }).generationConfig).toMatchObject({
      thinkingConfig: { thinkingLevel: 'low' },
    });
  });

  it('answers with the visible text and counts thinking as output', async () => {
    const fetchFn = stubFetch(answer());
    const result = await providerComplete({ model: 'claude-sonnet-5-5', messages: MESSAGES, maxTokens: 300 });
    expect(result).toEqual({ text: 'September 11.', inputTokens: 40, outputTokens: 35, servedBy: 'gemini-3.8-flash' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('gm-test');
  });

  it('degrades when a safety filter ends the answer', async () => {
    stubFetch(answer('SAFETY'));
    expect(await providerComplete({ model: 'claude-sonnet-5-5', messages: MESSAGES, maxTokens: 300 })).toBeNull();
  });

  it('steps a quota refusal on Pro down to Flash', async () => {
    const fetchFn = stubFetch({ status: 429 }, answer());
    const result = await providerComplete({ model: 'claude-opus-5-5', messages: MESSAGES, maxTokens: 300 });
    expect(fetchFn.mock.calls.map(([url]) => url.split('/models/')[1])).toEqual([
      'gemini-3.1-pro-preview:generateContent',
      'gemini-3.8-flash:generateContent',
    ]);
    expect(result).toMatchObject({ servedBy: 'gemini-3.8-flash', fellBackFrom: 'gemini-3.1-pro-preview' });
  });

  it('prices a Gemini answer at Gemini rates', () => {
    expect(isPricedServedBy('gemini-3.8-flash')).toBe(true);
    expect(costForServedBy('gemini-3.8-flash', 'claude-sonnet-5-5', 1_000_000, 1_000_000)).toBe(4.5);
  });
});
