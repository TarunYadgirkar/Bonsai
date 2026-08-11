import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryPersistenceBackend } from '@/lib/persistence/memory';
import type { Conversation } from '@/lib/types';

vi.mock('@/lib/provider', () => ({
  providerComplete: vi.fn().mockResolvedValue(null),
}));

import { POST as chatPost } from '@/app/api/chat/route';
import {
  configureStorePersistenceForTests,
  listLogs,
  putConversation,
  resetStore,
  saveStore,
} from '@/lib/store';

const ROOT_ID = 'real-mock-root';
const INSIGHT_TEXT =
  'Codex App Server streams structured JSON events for Bonsai clients.';

function request(body: unknown): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('zero-key route context flow', () => {
  beforeEach(async () => {
    configureStorePersistenceForTests(new MemoryPersistenceBackend());
    await resetStore();
  });

  it('answers a matching root question from a merged insight', async () => {
    const root: Conversation = {
      id: ROOT_ID,
      title: 'Real mock root',
      parentId: null,
      messages: [],
      insights: [
        {
          id: 'merged-runtime-insight',
          branchId: 'runtime-child',
          parentId: ROOT_ID,
          text: INSIGHT_TEXT,
          createdAt: '2026-08-11T00:00:00.000Z',
          sourceMessageIds: ['runtime-conclusion'],
          active: true,
        },
      ],
      pinnedTier: null,
      archived: false,
    };
    const child: Conversation = {
      id: 'runtime-child',
      title: 'Runtime child',
      parentId: ROOT_ID,
      messages: [
        { id: 'runtime-conclusion', role: 'assistant', content: INSIGHT_TEXT },
      ],
      brief: {
        id: 'runtime-child-brief',
        branchId: 'runtime-child',
        selection: 'Codex runtime',
        markdown: '# Runtime context',
        facts: ['Codex runtime is selected.'],
        excludedNote: 'Excluded: nothing.',
        availableTokens: 0,
        briefTokens: 4,
        prunedPct: 0,
        sourceRefs: [
          {
            kind: 'selection',
            conversationId: 'runtime-child',
            sourceId: 'selection:runtime-child',
          },
        ],
        factSourceIds: [['selection:runtime-child']],
        factProvenance: ['extractive'],
      },
      insights: [],
      pinnedTier: null,
      archived: true,
    };
    putConversation(root);
    putConversation(child);
    await saveStore();

    const response = await chatPost(
      request({
        branchId: ROOT_ID,
        content: 'What does Codex App Server stream for Bonsai clients?',
        mode: { mode: 'manual', model: 'claude-haiku-4-5', effort: 'low' },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.message.content).toBe(INSIGHT_TEXT);
    expect(body.message.content).not.toContain('does not cover');
    expect(listLogs().at(-1)).toMatchObject({ purpose: 'chat', status: 'succeeded' });
  });
});
