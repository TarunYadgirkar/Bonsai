import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssembledContext } from './types';

const llmMocks = vi.hoisted(() => ({
  complete: vi.fn(),
}));

vi.mock('./llm', () => ({
  complete: llmMocks.complete,
}));

import { compileBrief } from './compiler';

const parentContext: AssembledContext = {
  markdown: '[source:insight:i1]\nCodex App Server is the selected runtime.',
  sources: [
    {
      kind: 'insight',
      conversationId: 'parent-1',
      sourceId: 'i1',
      content: 'Codex App Server is the selected runtime.',
    },
  ],
  tokens: 12,
};

function compile(overrides: Partial<Parameters<typeof compileBrief>[0]> = {}) {
  return compileBrief({
    briefId: 'brief-1',
    branchId: 'branch-1',
    parentContext,
    selection: 'Codex App Server',
    question: 'Which runtime was selected?',
    availableTokens: 20,
    ...overrides,
  });
}

describe('compileBrief', () => {
  beforeEach(() => {
    llmMocks.complete.mockReset();
  });

  it('preserves valid fact provenance and compiler query sources', async () => {
    llmMocks.complete.mockResolvedValue({
      text: JSON.stringify({
        facts: [
          {
            text: 'Codex App Server is the selected runtime.',
            sourceIds: ['i1', 'unknown-source', 'i1'],
          },
        ],
        excludedNote: 'Excluded unrelated UI discussion.',
      }),
    });

    const brief = await compile();

    expect(brief.facts).toEqual(['Codex App Server is the selected runtime.']);
    expect(brief.factSourceIds).toEqual([['i1']]);
    expect(brief.sourceRefs.map((source) => source.sourceId)).toEqual([
      'i1',
      'selection:branch-1',
      'question:branch-1',
    ]);
    expect(parentContext.sources).toEqual([
      {
        kind: 'insight',
        conversationId: 'parent-1',
        sourceId: 'i1',
        content: 'Codex App Server is the selected runtime.',
      },
    ]);
  });

  it('uses deterministic cited fallback facts for invalid JSON', async () => {
    llmMocks.complete.mockResolvedValue({ text: 'not JSON' });

    const brief = await compile();

    expect(brief.facts).toEqual(['Codex App Server is the selected runtime.']);
    expect(brief.factSourceIds).toEqual([['i1']]);
    expect(brief.excludedNote).toContain('compiler fallback');
    expect(
      brief.factSourceIds.every(
        (sourceIds) =>
          sourceIds.length > 0 &&
          sourceIds.every((sourceId) =>
            brief.sourceRefs.some((source) => source.sourceId === sourceId),
          ),
      ),
    ).toBe(true);
  });

  it('falls back to the selection source when no parent source overlaps', async () => {
    llmMocks.complete.mockResolvedValue({ text: 'not JSON' });

    const brief = await compile({
      parentContext: {
        markdown: '[source:message:m1]\nA completely unrelated sentence.',
        sources: [
          {
            kind: 'message',
            conversationId: 'parent-1',
            sourceId: 'm1',
            content: 'A completely unrelated sentence.',
          },
        ],
        tokens: 8,
      },
    });

    expect(brief.facts).toEqual(['Topic in focus: Codex App Server.']);
    expect(brief.factSourceIds).toEqual([['selection:branch-1']]);
    expect(brief.excludedNote).toContain('degraded compiler fallback');
  });

  it('turns a relevant punctuationless source into a cited fallback sentence', async () => {
    llmMocks.complete.mockResolvedValue({ text: 'not JSON' });

    const brief = await compile({
      parentContext: {
        markdown: '[source:message:m1]\nCodex App Server runtime',
        sources: [
          {
            kind: 'message',
            conversationId: 'parent-1',
            sourceId: 'm1',
            content: 'Codex App Server runtime',
          },
        ],
        tokens: 6,
      },
    });

    expect(brief.facts).toEqual(['Codex App Server runtime.']);
    expect(brief.factSourceIds).toEqual([['m1']]);
  });

  it('drops malformed facts, validates IDs, preserves order, and caps facts', async () => {
    llmMocks.complete.mockResolvedValue({
      text: JSON.stringify({
        facts: [
          { text: '', sourceIds: ['i1'] },
          { text: 42, sourceIds: ['i1'] },
          ...Array.from({ length: 10 }, (_, index) => ({
            text: `Fact ${index + 1}.`,
            sourceIds: ['question:branch-1', 'i1', 'question:branch-1', null],
          })),
        ],
        excludedNote: 'Excluded unrelated details.',
      }),
    });

    const brief = await compile();

    expect(brief.facts).toHaveLength(8);
    expect(brief.facts[0]).toBe('Fact 1.');
    expect(brief.facts[7]).toBe('Fact 8.');
    expect(brief.factSourceIds).toEqual(
      Array.from({ length: 8 }, () => ['question:branch-1', 'i1']),
    );
  });
});
