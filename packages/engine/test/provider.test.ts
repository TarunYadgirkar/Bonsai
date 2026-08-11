import { describe, expect, it } from 'vitest';
import { anthropicBody } from '../src/provider';
import { costForServedBy } from '../src/models';

const MESSAGES = [
  { role: 'system' as const, content: 'You answer briefly.' },
  { role: 'user' as const, content: 'When do apps close?' },
];

describe('anthropicBody param policy', () => {
  it('sends temperature and no effort on Haiku 4.5', () => {
    const body = anthropicBody('claude-haiku-4-5-20251001', {
      messages: MESSAGES,
      maxTokens: 300,
      effort: 'low',
      temperature: 0.7,
    });
    expect(body.temperature).toBe(0.7);
    expect(body.output_config).toBeUndefined();
    expect(body.max_tokens).toBe(300);
  });

  it('never sends sampling params on 5-family models', () => {
    for (const upstream of ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5']) {
      const body = anthropicBody(upstream, {
        messages: MESSAGES,
        maxTokens: 300,
        effort: 'high',
        temperature: 0.7,
      });
      expect(body.temperature, upstream).toBeUndefined();
      expect(body.output_config, upstream).toEqual({ effort: 'high' });
    }
  });

  it('raises max_tokens to the effort total cap on adaptive-thinking models', () => {
    const body = anthropicBody('claude-opus-5', {
      messages: MESSAGES,
      maxTokens: 1500,
      effort: 'high',
    });
    expect(body.max_tokens).toBe(12000);

    const generous = anthropicBody('claude-opus-5', {
      messages: MESSAGES,
      maxTokens: 20000,
      effort: 'high',
    });
    expect(generous.max_tokens).toBe(20000);
  });

  it('lifts the system message to the top-level field', () => {
    const body = anthropicBody('claude-sonnet-5', { messages: MESSAGES, maxTokens: 300 });
    expect(body.system).toBe('You answer briefly.');
    expect(body.messages).toEqual([{ role: 'user', content: 'When do apps close?' }]);
  });
});

describe('costForServedBy', () => {
  it('prices by the upstream that actually answered', () => {
    expect(costForServedBy('gpt-5.4-mini', 'claude-haiku-4-5', 1_000_000, 0)).toBe(0.75);
    expect(costForServedBy('grok-4.5', 'claude-opus-5', 0, 1_000_000)).toBe(6);
  });

  it('falls back to the Bonsai catalog rate for Anthropic or unknown upstreams', () => {
    expect(costForServedBy('claude-opus-5', 'claude-opus-5', 1_000_000, 0)).toBe(5);
    expect(costForServedBy(undefined, 'claude-fable-5', 1_000_000, 0)).toBe(10);
  });
});
