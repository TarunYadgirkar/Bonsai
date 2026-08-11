import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerComplete } from './provider';

describe('providerComplete', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('surfaces a configured provider failure instead of returning the mock sentinel', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'configured-test-key');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('XAI_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));

    await expect(
      providerComplete({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'hello' }],
        maxTokens: 20,
      }),
    ).rejects.toThrow(/anthropic 429/i);
  });

  it('returns the mock sentinel only when no provider is configured', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('XAI_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      providerComplete({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'hello' }],
        maxTokens: 20,
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves exact usage metadata for a completed blank provider response', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'configured-test-key');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('XAI_API_KEY', '');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          content: [{ type: 'text', text: '   ' }],
          usage: { input_tokens: 37, output_tokens: 2 },
        }),
      ),
    );

    await expect(
      providerComplete({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'hello' }],
        maxTokens: 20,
      }),
    ).resolves.toEqual({
      text: '   ',
      inputTokens: 37,
      outputTokens: 2,
      servedBy: 'claude-haiku-4-5-20251001',
    });
  });
});
