import { describe, expect, it } from 'vitest';
import { completeStream, type CompleteResult } from '../src/llm';
import { completeWithEscalation } from '../src/router';
import type { RoutingDecision } from '../src/types';

const routing: RoutingDecision = {
  tier: 'thoughtful',
  model: 'claude-sonnet-5',
  effortNote: 'test',
  contextTokens: 10,
  estCostUsd: 0,
  reason: 'test',
  complexity: 2,
  escalated: false,
  overridden: false,
};

function fakeResult(text: string): CompleteResult {
  return {
    text,
    model: 'claude-sonnet-5',
    tier: 'thoughtful',
    inputTokens: 10,
    outputTokens: 5,
    estCostUsd: 0.001,
    mock: true,
  };
}

describe('completeStream (mock path)', () => {
  it('chunks reassemble to exactly the buffered answer', async () => {
    const chunks: string[] = [];
    const result = await completeStream(
      {
        tier: 'thoughtful',
        purpose: 'chat',
        messages: [
          { role: 'system', content: 'answer' },
          { role: 'user', content: 'Context.\n\n---\nWhy do trees shed leaves and how does that help them survive winter conditions?' },
        ],
      },
      (c) => chunks.push(c),
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(result.text);
    expect(result.mock).toBe(true);
  });
});

describe('completeWithEscalation streaming taps', () => {
  it('streams via deps.completeStream when onDelta is tapped', async () => {
    const chunks: string[] = [];
    const result = await completeWithEscalation(
      {
        routing,
        systemPrompt: 'sys',
        userPrompt: 'question',
        onDelta: (c) => chunks.push(c),
      },
      {
        complete: async () => {
          throw new Error('buffered path must not be used when streaming is tapped');
        },
        completeStream: async (_params, onDelta) => {
          onDelta('a good ');
          onDelta('long answer that passes the sanity check easily.');
          return fakeResult('a good long answer that passes the sanity check easily.');
        },
      },
    );
    expect(chunks.join('')).toBe(result.text);
    expect(result.routing.escalated).toBe(false);
  });

  it('fires onRestart before the escalated retry and streams the second attempt', async () => {
    const events: string[] = [];
    let calls = 0;
    const result = await completeWithEscalation(
      {
        routing,
        systemPrompt: 'sys',
        userPrompt: 'question',
        onDelta: (c) => events.push(`delta:${c}`),
        onRestart: (reason) => events.push(`restart:${reason}`),
      },
      {
        complete: async () => fakeResult('unused'),
        completeStream: async (_params, onDelta) => {
          calls += 1;
          if (calls === 1) {
            onDelta('short'); // fails the sanity check at complexity 2
            return fakeResult('short');
          }
          onDelta('a much better answer, long enough to satisfy the sanity check.');
          return fakeResult('a much better answer, long enough to satisfy the sanity check.');
        },
      },
    );
    expect(result.routing.escalated).toBe(true);
    const restartIdx = events.indexOf('restart:escalated');
    expect(restartIdx).toBeGreaterThan(0);
    expect(events.slice(restartIdx + 1).join('')).toContain('a much better answer');
    expect(result.text).toBe('a much better answer, long enough to satisfy the sanity check.');
  });
});
