import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompleteParams, CompleteResult } from '@/lib/llm';
import { CEILING_MODEL, MODEL_TIERS, TIER_DEFAULTS, costForModel } from '@/lib/models';
import { ProviderUnavailableError } from '@/lib/provider';
import { MemoryPersistenceBackend } from '@/lib/persistence/memory';
import type { StoreSnapshot } from '@/lib/store-schema';
import { estimateTokens } from '@/lib/tokens';
import type { Conversation, InferenceLog } from '@/lib/types';

const llmMocks = vi.hoisted(() => ({
  complete: vi.fn<(params: CompleteParams) => Promise<CompleteResult>>(),
}));
vi.mock('@/lib/llm', () => ({ complete: llmMocks.complete }));

import { POST as branchPost } from '@/app/api/branch/route';
import { POST as chatPost } from '@/app/api/chat/route';
import {
  availableTokensFor,
  configureStorePersistenceForTests,
  getConversation,
  listConversations,
  listLogs,
  loadStore,
} from '@/lib/store';

const ROOT_ID = 'logging-root';

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function result(
  params: CompleteParams,
  text: string,
  exact: { input: number; output: number; cost: number; servedBy: string },
): CompleteResult {
  return {
    text,
    tier: params.tier,
    model: params.model ?? MODEL_TIERS[params.tier],
    effort: params.effort ?? TIER_DEFAULTS[params.tier].effort,
    inputTokens: exact.input,
    outputTokens: exact.output,
    estCostUsd: exact.cost,
    mock: false,
    servedBy: exact.servedBy,
  };
}

function root(): Conversation {
  return {
    id: ROOT_ID,
    title: 'Logging root',
    parentId: null,
    messages: [
      {
        id: 'root-message',
        role: 'user',
        content: 'Use SQLite for local storage. '.repeat(32),
      },
    ],
    insights: [],
    pinnedTier: null,
    archived: false,
  };
}

function lastBatch(): InferenceLog[] {
  return listLogs();
}

describe('exact inference logging', () => {
  beforeEach(async () => {
    llmMocks.complete.mockReset();
    configureStorePersistenceForTests(
      new MemoryPersistenceBackend({
        initialSnapshot: { conversations: [root()], logs: [], rootId: ROOT_ID, seq: 0 },
      }),
    );
    await loadStore();
  });

  it('logs the classifier and every answer retry without aggregating metadata', async () => {
    const question = 'Which local storage should we use?';
    const baselineInputTokens = availableTokensFor(ROOT_ID) + estimateTokens(question);
    llmMocks.complete
      .mockImplementationOnce(async (params) =>
        result(params, '{"complexity":1,"reason":"single fact"}', {
          input: 11,
          output: 2,
          cost: 0.000011,
          servedBy: 'provider-classifier',
        }),
      )
      .mockImplementationOnce(async (params) =>
        result(params, 'tiny', {
          input: 21,
          output: 3,
          cost: 0.000021,
          servedBy: 'provider-quick',
        }),
      )
      .mockImplementationOnce(async (params) =>
        result(params, 'SQLite is the supported local store for this branch and its clients.', {
          input: 31,
          output: 7,
          cost: 0.000031,
          servedBy: 'provider-thoughtful',
        }),
      );

    const response = await chatPost(request('/api/chat', { branchId: ROOT_ID, content: question }));
    expect(response.status).toBe(200);
    const body = await response.json();
    const logs = lastBatch();

    expect(logs).toHaveLength(3);
    expect(logs[0]).toMatchObject({
      purpose: 'classify',
      model: 'claude-haiku-4-5',
      servedBy: 'provider-classifier',
      inputTokens: 11,
      outputTokens: 2,
      estCostUsd: 0.000011,
      status: 'succeeded',
      baselineInputTokens: 0,
      baselineCostUsd: 0,
    });
    expect(logs[1]).toMatchObject({
      purpose: 'chat',
      model: 'claude-haiku-4-5',
      servedBy: 'provider-quick',
      inputTokens: 21,
      outputTokens: 3,
      estCostUsd: 0.000021,
      status: 'failed',
      baselineInputTokens: 0,
      baselineCostUsd: 0,
    });
    expect(logs[2]).toMatchObject({
      purpose: 'chat',
      model: 'claude-sonnet-5',
      servedBy: 'provider-thoughtful',
      inputTokens: 31,
      outputTokens: 7,
      estCostUsd: 0.000031,
      status: 'succeeded',
      baselineInputTokens,
      baselineCostUsd: costForModel(CEILING_MODEL, baselineInputTokens, 7),
    });
    expect(body.log.id).toBe(logs[2].id);
    expect(body.routing).toMatchObject({
      model: 'claude-sonnet-5',
      servedBy: 'provider-thoughtful',
      estCostUsd: 0.000031,
      escalated: true,
    });
  });

  it('includes the initial branch question in routing and its sole delivered baseline', async () => {
    const question = 'Should this branch use SQLite?';
    const parentHistoryTokens = availableTokensFor(ROOT_ID);
    llmMocks.complete
      .mockImplementationOnce(async (params) =>
        result(
          params,
          JSON.stringify({
            facts: [{ text: 'Use SQLite for local storage.', sourceIds: ['root-message'] }],
            excludedNote: 'Excluded unrelated context.',
          }),
          { input: 111, output: 12, cost: 0.00111, servedBy: 'provider-compiler' },
        ),
      )
      .mockImplementationOnce(async (params) =>
        result(params, 'Use SQLite for this branch because the supplied brief explicitly says so.', {
          input: 222,
          output: 20,
          cost: 0.00222,
          servedBy: 'provider-answer',
        }),
      );

    const response = await branchPost(
      request('/api/branch', {
        parentId: ROOT_ID,
        selection: 'SQLite',
        question,
        mode: { mode: 'manual', model: 'claude-fable-5', effort: 'max' },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const logs = lastBatch();
    const expectedBaseline = parentHistoryTokens + estimateTokens(question);

    expect(body.brief.availableTokens).toBe(parentHistoryTokens);
    expect(body.routing.contextTokens).toBe(body.brief.briefTokens + estimateTokens(question));
    expect(body.routing.overridden).toBe(true);
    expect(body.message.routing.overridden).toBe(true);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      purpose: 'compile',
      model: 'claude-haiku-4-5',
      servedBy: 'provider-compiler',
      inputTokens: 111,
      outputTokens: 12,
      estCostUsd: 0.00111,
      baselineInputTokens: 0,
      baselineCostUsd: 0,
    });
    expect(logs[1]).toMatchObject({
      purpose: 'chat',
      model: 'claude-fable-5',
      effort: 'max',
      servedBy: 'provider-answer',
      inputTokens: 222,
      outputTokens: 20,
      estCostUsd: 0.00222,
      overridden: true,
      baselineInputTokens: expectedBaseline,
      baselineCostUsd: costForModel(CEILING_MODEL, expectedBaseline, 20),
    });
  });

  it('keeps messages staged and logs a completed failed retry if escalation rejects', async () => {
    llmMocks.complete
      .mockImplementationOnce(async (params) =>
        result(params, 'tiny', {
          input: 51,
          output: 4,
          cost: 0.000051,
          servedBy: 'provider-quick',
        }),
      )
      .mockRejectedValueOnce(new ProviderUnavailableError('provider unavailable'));

    const response = await chatPost(
      request('/api/chat', {
        branchId: ROOT_ID,
        content: 'Will retry accounting stay exact?',
        mode: { mode: 'manual', model: 'claude-haiku-4-5', effort: 'low' },
      }),
    );

    expect(response.status).toBe(502);
    expect(getConversation(ROOT_ID)?.messages).toEqual(root().messages);
    expect(lastBatch()).toEqual([
      expect.objectContaining({
        purpose: 'chat',
        model: 'claude-haiku-4-5',
        servedBy: 'provider-quick',
        inputTokens: 51,
        outputTokens: 4,
        estCostUsd: 0.000051,
        status: 'failed',
        baselineInputTokens: 0,
        baselineCostUsd: 0,
      }),
    ]);
  });

  it('preserves manual routing metadata when a new branch escalation rejects', async () => {
    const committedSnapshots: StoreSnapshot[] = [];
    configureStorePersistenceForTests(
      new MemoryPersistenceBackend({
        initialSnapshot: { conversations: [root()], logs: [], rootId: ROOT_ID, seq: 0 },
        beforeCommit: (_previous, next) => {
          committedSnapshots.push(next);
        },
      }),
    );
    await loadStore();
    llmMocks.complete
      .mockImplementationOnce(async (params) =>
        result(
          params,
          JSON.stringify({
            facts: [{ text: 'Use SQLite for local storage.', sourceIds: ['root-message'] }],
            excludedNote: 'Excluded unrelated context.',
          }),
          { input: 61, output: 6, cost: 0.000061, servedBy: 'provider-compiler' },
        ),
      )
      .mockImplementationOnce(async (params) =>
        result(params, 'tiny', {
          input: 62,
          output: 2,
          cost: 0.000062,
          servedBy: 'provider-quick',
        }),
      )
      .mockRejectedValueOnce(new ProviderUnavailableError('provider unavailable'));

    const response = await branchPost(
      request('/api/branch', {
        parentId: ROOT_ID,
        selection: 'SQLite',
        question: 'Should we use it?',
        mode: { mode: 'manual', model: 'claude-haiku-4-5', effort: 'low' },
      }),
    );

    expect(response.status).toBe(502);
    expect(listConversations()).toEqual([root()]);
    expect(committedSnapshots).toHaveLength(1);
    expect(committedSnapshots[0].conversations).toEqual([root()]);
    expect(committedSnapshots[0].logs).toEqual([
      expect.objectContaining({
        purpose: 'compile',
        servedBy: 'provider-compiler',
        status: 'succeeded',
      }),
      expect.objectContaining({
        purpose: 'chat',
        model: 'claude-haiku-4-5',
        effort: 'low',
        servedBy: 'provider-quick',
        inputTokens: 62,
        outputTokens: 2,
        estCostUsd: 0.000062,
        status: 'failed',
        escalated: true,
        overridden: true,
        baselineInputTokens: 0,
        baselineCostUsd: 0,
      }),
    ]);
  });

  it('treats an at-ceiling sanity miss as the delivered baseline event', async () => {
    const question = 'Answer even if terse.';
    const baselineInputTokens = availableTokensFor(ROOT_ID) + estimateTokens(question);
    llmMocks.complete.mockImplementationOnce(async (params) =>
      result(params, 'Terse.', {
        input: 71,
        output: 2,
        cost: 0.000071,
        servedBy: 'provider-ceiling',
      }),
    );

    const response = await chatPost(
      request('/api/chat', {
        branchId: ROOT_ID,
        content: question,
        mode: { mode: 'manual', model: CEILING_MODEL, effort: 'max' },
      }),
    );

    expect(response.status).toBe(200);
    expect(getConversation(ROOT_ID)?.messages.at(-1)?.content).toBe('Terse.');
    expect(lastBatch()).toEqual([
      expect.objectContaining({
        purpose: 'chat',
        model: CEILING_MODEL,
        servedBy: 'provider-ceiling',
        status: 'succeeded',
        baselineInputTokens,
        baselineCostUsd: costForModel(CEILING_MODEL, baselineInputTokens, 2),
      }),
    ]);
  });

  it('persists compiler and classifier overhead when a new branch answer rejects', async () => {
    const conversationsBefore = listConversations().length;
    llmMocks.complete
      .mockImplementationOnce(async (params) =>
        result(
          params,
          JSON.stringify({
            facts: [{ text: 'Use SQLite for local storage.', sourceIds: ['root-message'] }],
            excludedNote: 'Excluded unrelated context.',
          }),
          { input: 61, output: 6, cost: 0.000061, servedBy: 'provider-compiler' },
        ),
      )
      .mockImplementationOnce(async (params) =>
        result(params, '{"complexity":1,"reason":"single fact"}', {
          input: 62,
          output: 2,
          cost: 0.000062,
          servedBy: 'provider-classifier',
        }),
      )
      .mockRejectedValueOnce(new ProviderUnavailableError('provider unavailable'));

    const response = await branchPost(
      request('/api/branch', {
        parentId: ROOT_ID,
        selection: 'SQLite',
        question: 'Should we use it?',
      }),
    );

    expect(response.status).toBe(502);
    expect(listConversations()).toHaveLength(conversationsBefore);
    expect(lastBatch().map((log) => [log.purpose, log.servedBy, log.baselineCostUsd])).toEqual([
      ['compile', 'provider-compiler', 0],
      ['classify', 'provider-classifier', 0],
    ]);
  });
});
