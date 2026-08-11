import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompleteParams, CompleteResult } from '@/lib/llm';
import { TIER_DEFAULTS } from '@/lib/models';
import { ProviderUnavailableError } from '@/lib/provider';
import { estimateTokens } from '@/lib/tokens';
import type { ContextBrief, Conversation } from '@/lib/types';

const llmMocks = vi.hoisted(() => ({
  complete: vi.fn<(params: CompleteParams) => Promise<CompleteResult>>(),
}));

const inferenceLogMocks = vi.hoisted(() => ({
  appendInferenceLogs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/llm', () => ({
  complete: llmMocks.complete,
}));

vi.mock('@/lib/inference-log', () => ({
  appendInferenceLogs: inferenceLogMocks.appendInferenceLogs,
}));

vi.mock('@/lib/kv', () => ({
  kvEnabled: () => false,
  kvGet: vi.fn(),
  kvSet: vi.fn(),
}));

import { POST as branchPost } from '@/app/api/branch/route';
import { POST as chatPost } from '@/app/api/chat/route';
import { POST as mergePost } from '@/app/api/merge/route';
import {
  availableTokensFor,
  getConversation,
  listConversations,
  listLogs,
  putConversation,
  resetStore,
  visibleContextFor,
} from '@/lib/store';

const ROOT_ID = 'context-flow-root';
const CHILD_ID = 'context-flow-child';
const RELEVANT_TEXT = 'The selected runtime is Codex App Server.';
const UNRELATED_TEXT = 'The office ficus needs watering every Thursday.';
const CHILD_CONCLUSION = 'The runtime should stream structured JSON events to every client.';
const INSIGHT_TEXT = 'Codex App Server should stream structured JSON events to every client.';

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function childBrief(): ContextBrief {
  const markdown = [
    '# Branch brief — Codex App Server runtime',
    '',
    '## Relevant facts',
    `- ${RELEVANT_TEXT}`,
    '',
    'Question: How should the runtime communicate?',
  ].join('\n');

  return {
    id: 'context-flow-child-brief',
    branchId: CHILD_ID,
    selection: 'Codex App Server runtime',
    markdown,
    facts: [RELEVANT_TEXT],
    excludedNote: 'Excluded unrelated root details.',
    availableTokens: 30,
    briefTokens: estimateTokens(markdown),
    prunedPct: 50,
    sourceRefs: [
      { kind: 'message', conversationId: ROOT_ID, sourceId: 'root-relevant' },
    ],
    factSourceIds: [['root-relevant']],
    factProvenance: ['model-cited'],
  };
}

function completion(params: CompleteParams, text: string): CompleteResult {
  const inputTokens = params.messages.reduce(
    (total, message) => total + estimateTokens(message.content) + 4,
    0,
  );

  return {
    text,
    model: params.model ?? 'claude-haiku-4-5',
    tier: params.tier,
    effort: params.effort ?? TIER_DEFAULTS[params.tier].effort,
    inputTokens,
    outputTokens: estimateTokens(text),
    estCostUsd: 0.0001,
    mock: true,
  };
}

function sourceId(prompt: string, kind: 'brief' | 'insight'): string {
  const id = new RegExp(`\\[source:${kind}:([^\\]]+)\\]`).exec(prompt)?.[1];
  if (!id) throw new Error(`missing ${kind} source in compiler prompt`);
  return id;
}

describe('route context flow', () => {
  beforeEach(async () => {
    llmMocks.complete.mockReset();
    inferenceLogMocks.appendInferenceLogs.mockReset();
    inferenceLogMocks.appendInferenceLogs.mockResolvedValue(undefined);
    await resetStore();

    llmMocks.complete.mockImplementation(async (params) => {
      const systemPrompt = params.messages[0]?.content ?? '';
      const userPrompt = params.messages[1]?.content ?? '';

      if (systemPrompt.startsWith('Extract the single durable conclusion')) {
        return completion(params, INSIGHT_TEXT);
      }

      if (systemPrompt.startsWith('You compile minimal context briefs')) {
        const citedSourceId = userPrompt.includes('[source:brief:')
          ? sourceId(userPrompt, 'brief')
          : sourceId(userPrompt, 'insight');
        return completion(
          params,
          JSON.stringify({
            facts: [{ text: INSIGHT_TEXT, sourceIds: [citedSourceId] }],
            excludedNote: 'Excluded unrelated context.',
          }),
        );
      }

      if (systemPrompt.startsWith('You answer using only')) {
        return completion(
          params,
          'The visible context supports Codex App Server with structured JSON event streaming.',
        );
      }

      throw new Error(`unexpected inference purpose: ${systemPrompt}`);
    });
  });

  it('carries merged evidence through a parent brief, nested brief, and root chat', async () => {
    const root: Conversation = {
      id: ROOT_ID,
      title: 'Context flow root',
      parentId: null,
      messages: [
        { id: 'root-relevant', role: 'user', content: RELEVANT_TEXT },
        { id: 'root-unrelated', role: 'assistant', content: UNRELATED_TEXT },
      ],
      insights: [],
      pinnedTier: null,
      archived: false,
    };
    const storedChildBrief = childBrief();
    const child: Conversation = {
      id: CHILD_ID,
      title: 'Runtime transport',
      parentId: ROOT_ID,
      messages: [{ id: 'child-conclusion', role: 'assistant', content: CHILD_CONCLUSION }],
      brief: storedChildBrief,
      insights: [],
      pinnedTier: null,
      archived: false,
    };
    putConversation(root);
    putConversation(child);

    const mergeResponse = await mergePost(request('/api/merge', { branchId: CHILD_ID }));
    expect(mergeResponse.status).toBe(200);
    const mergeBody = await mergeResponse.json();
    expect(mergeBody.insight).toMatchObject({
      text: INSIGHT_TEXT,
      sourceMessageIds: ['child-conclusion'],
      active: true,
    });

    const mergeCall = llmMocks.complete.mock.calls.find(([params]) =>
      params.messages[0]?.content.startsWith('Extract the single durable conclusion'),
    );
    if (!mergeCall) throw new Error('merge completion was not called');
    const mergeUsage = completion(mergeCall[0], INSIGHT_TEXT);
    expect(mergeBody.log).toMatchObject({
      inputTokens: mergeUsage.inputTokens,
      outputTokens: mergeUsage.outputTokens,
    });
    expect(mergeCall[0].messages[1]?.content).toContain(
      JSON.stringify(storedChildBrief.markdown),
    );
    expect(mergeCall?.[0].messages[1]?.content).toContain(CHILD_CONCLUSION);

    const parentQuestion = 'How should the runtime behave?';
    const parentResponse = await branchPost(
      request('/api/branch', {
        parentId: ROOT_ID,
        selection: 'Codex App Server streaming',
        question: parentQuestion,
        mode: { mode: 'manual', model: 'claude-haiku-4-5', effort: 'low' },
      }),
    );
    expect(parentResponse.status).toBe(200);
    const parentBody = await parentResponse.json();
    const parentBrief = parentBody.brief as ContextBrief;
    expect(parentBrief.factSourceIds).toEqual([[mergeBody.insight.id]]);

    const answerCalls = llmMocks.complete.mock.calls.filter(([params]) =>
      params.messages[0]?.content.startsWith('You answer using only'),
    );
    expect(answerCalls[0]?.[0].messages[1]?.content).toBe(
      `${parentBrief.markdown}\n\n---\n${parentQuestion}`,
    );

    const nestedResponse = await branchPost(
      request('/api/branch', {
        parentId: parentBody.conversation.id,
        selection: 'structured JSON runtime',
      }),
    );
    expect(nestedResponse.status).toBe(200);
    const nestedBody = await nestedResponse.json();
    const nestedBrief = nestedBody.brief as ContextBrief;
    expect(nestedBrief.sourceRefs).toContainEqual({
      kind: 'brief',
      conversationId: parentBody.conversation.id,
      sourceId: parentBrief.id,
    });
    expect(nestedBrief.markdown).toContain(INSIGHT_TEXT);
    expect(nestedBrief.markdown).not.toContain(UNRELATED_TEXT);
    expect(nestedBrief.sourceRefs).not.toContainEqual(
      expect.objectContaining({ sourceId: 'root-unrelated' }),
    );

    const question = 'What runtime did we settle on?';
    const contextBeforeQuestion = visibleContextFor(ROOT_ID);
    if (!contextBeforeQuestion) throw new Error('root context unavailable');
    const expectedBaseline = availableTokensFor(ROOT_ID) + estimateTokens(question);
    const chatResponse = await chatPost(
      request('/api/chat', {
        branchId: ROOT_ID,
        content: question,
        mode: { mode: 'manual', model: 'claude-haiku-4-5', effort: 'low' },
      }),
    );
    expect(chatResponse.status).toBe(200);
    const chatBody = await chatResponse.json();
    expect(chatBody.routing.contextTokens).toBe(
      contextBeforeQuestion.tokens + estimateTokens(question),
    );
    expect(chatBody.log.baselineInputTokens).toBe(expectedBaseline);

    const chatAnswerCall = llmMocks.complete.mock.calls
      .filter(([params]) => params.messages[0]?.content.startsWith('You answer using only'))
      .at(-1);
    expect(chatAnswerCall?.[0].messages[1]?.content).toBe(
      `${contextBeforeQuestion.markdown}\n\n---\n${question}`,
    );
    expect(chatAnswerCall?.[0].messages[1]?.content).toContain(INSIGHT_TEXT);
    expect(
      getConversation(ROOT_ID)?.messages.filter((message) => message.content === question),
    ).toHaveLength(1);
    expect(inferenceLogMocks.appendInferenceLogs).toHaveBeenCalled();
  });

  it('records a blank merge completion as failed without mutating either conversation', async () => {
    const root: Conversation = {
      id: ROOT_ID,
      title: 'Context flow root',
      parentId: null,
      messages: [],
      insights: [],
      pinnedTier: null,
      archived: false,
    };
    const storedChildBrief = childBrief();
    const child: Conversation = {
      id: CHILD_ID,
      title: 'Runtime transport',
      parentId: ROOT_ID,
      messages: [{ id: 'child-conclusion', role: 'assistant', content: CHILD_CONCLUSION }],
      brief: storedChildBrief,
      insights: [],
      pinnedTier: null,
      archived: false,
    };
    putConversation(root);
    putConversation(child);
    llmMocks.complete.mockImplementationOnce(async (params) => ({
      ...completion(params, '"   "'),
      inputTokens: 321,
      outputTokens: 99,
      estCostUsd: 0.004321,
      servedBy: 'merge-provider',
    }));

    const response = await mergePost(request('/api/merge', { branchId: CHILD_ID }));
    expect(response.status).toBe(502);
    const body = await response.json();

    expect(body).toEqual({ error: 'merge produced no durable insight' });
    expect(getConversation(ROOT_ID)?.insights).toEqual([]);
    expect(getConversation(CHILD_ID)?.archived).toBe(false);
    expect(inferenceLogMocks.appendInferenceLogs).toHaveBeenCalledWith([
      expect.objectContaining({
        purpose: 'merge',
        status: 'failed',
        inputTokens: 321,
        outputTokens: 99,
        estCostUsd: 0.004321,
        servedBy: 'merge-provider',
        baselineInputTokens: 0,
        baselineCostUsd: 0,
      }),
    ]);
  });

  it('does not append a chat turn when answer completion rejects', async () => {
    const root: Conversation = {
      id: ROOT_ID,
      title: 'Context flow root',
      parentId: null,
      messages: [],
      insights: [],
      pinnedTier: null,
      archived: false,
    };
    putConversation(root);
    llmMocks.complete.mockRejectedValueOnce(new ProviderUnavailableError('provider unavailable'));

    const response = await chatPost(
      request('/api/chat', {
        branchId: ROOT_ID,
        content: 'Will this be staged?',
        mode: { mode: 'manual', model: 'claude-haiku-4-5', effort: 'low' },
      }),
    );

    expect(response.status).toBe(502);
    expect(getConversation(ROOT_ID)?.messages).toEqual([]);
  });

  it('does not persist a branch but records completed overhead when its answer rejects', async () => {
    const root: Conversation = {
      id: ROOT_ID,
      title: 'Context flow root',
      parentId: null,
      messages: [{ id: 'root-relevant', role: 'user', content: RELEVANT_TEXT }],
      insights: [],
      pinnedTier: null,
      archived: false,
    };
    putConversation(root);
    const conversationsBefore = listConversations().length;
    const logsBefore = listLogs().length;
    llmMocks.complete
      .mockImplementationOnce(async (params) =>
        completion(
          params,
          JSON.stringify({
            facts: [{ text: RELEVANT_TEXT, sourceIds: ['root-relevant'] }],
            excludedNote: 'Excluded unrelated context.',
          }),
        ),
      )
      .mockRejectedValueOnce(new ProviderUnavailableError('provider unavailable'));

    const response = await branchPost(
      request('/api/branch', {
        parentId: ROOT_ID,
        selection: 'selected runtime',
        question: 'Which runtime?',
        mode: { mode: 'manual', model: 'claude-haiku-4-5', effort: 'low' },
      }),
    );

    expect(response.status).toBe(502);
    expect(listConversations()).toHaveLength(conversationsBefore);
    expect(listLogs()).toHaveLength(logsBefore + 1);
    expect(listLogs().at(-1)).toMatchObject({
      purpose: 'compile',
      status: 'succeeded',
      baselineInputTokens: 0,
      baselineCostUsd: 0,
    });
  });
});
