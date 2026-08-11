import type { CompleteFn, CompleteParams, CompleteResult } from '../src/llm';

export function llmResult(text: string, overrides: Partial<CompleteResult> = {}): CompleteResult {
  return {
    text,
    model: 'claude-haiku-4-5',
    tier: 'quick',
    inputTokens: 100,
    outputTokens: 40,
    estCostUsd: 0.25,
    mock: true,
    ...overrides,
  };
}

export function fakeComplete(script: CompleteResult[]): {
  complete: CompleteFn;
  calls: CompleteParams[];
} {
  const calls: CompleteParams[] = [];
  const complete: CompleteFn = async (params) => {
    calls.push(params);
    return script[Math.min(calls.length, script.length) - 1];
  };
  return { complete, calls };
}
