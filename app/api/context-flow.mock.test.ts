import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/lib/types';

const inferenceLogMocks = vi.hoisted(() => ({
  appendInferenceLogs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/provider', () => ({
  providerComplete: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/inference-log', () => ({
  appendInferenceLogs: inferenceLogMocks.appendInferenceLogs,
}));

vi.mock('@/lib/kv', () => ({
  kvEnabled: () => false,
  kvGet: vi.fn(),
  kvSet: vi.fn(),
}));

import { POST as chatPost } from '@/app/api/chat/route';
import { putConversation, resetStore } from '@/lib/store';

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
    inferenceLogMocks.appendInferenceLogs.mockClear();
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
    putConversation(root);

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
    expect(inferenceLogMocks.appendInferenceLogs).toHaveBeenCalled();
  });
});
