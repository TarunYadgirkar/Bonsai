import { beforeEach, describe, expect, it, vi } from 'vitest';

const llmMocks = vi.hoisted(() => ({ complete: vi.fn() }));

vi.mock('@/lib/llm', () => ({ complete: llmMocks.complete }));
vi.mock('@/lib/inference-log', () => ({ appendInferenceLogs: vi.fn() }));
vi.mock('@/lib/kv', () => ({
  kvEnabled: () => false,
  kvGet: vi.fn(),
  kvSet: vi.fn(),
}));

import { POST as branchPost } from '@/app/api/branch/route';
import { POST as chatPost } from '@/app/api/chat/route';
import { POST as conversationPost } from '@/app/api/conversation/route';
import { POST as mergePost } from '@/app/api/merge/route';
import { listConversations, listLogs, resetStore } from '@/lib/store';

type Post = (request: Request) => Promise<Response>;

function rawRequest(path: string, body: string, contentType?: string): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: contentType ? { 'content-type': contentType } : undefined,
    body,
  });
}

const routes: Array<{ name: string; path: string; post: Post }> = [
  { name: 'branch', path: '/api/branch', post: branchPost },
  { name: 'chat', path: '/api/chat', post: chatPost },
  { name: 'merge', path: '/api/merge', post: mergePost },
  { name: 'conversation', path: '/api/conversation', post: conversationPost },
];

describe('POST JSON validation', () => {
  beforeEach(async () => {
    llmMocks.complete.mockReset();
    await resetStore();
  });

  it.each(routes)('rejects malformed JSON before state or inference on $name', async (route) => {
    const conversationsBefore = listConversations();
    const logsBefore = listLogs();

    const response = await route.post(rawRequest(route.path, '{', 'application/json'));

    expect(response.status).toBe(400);
    expect(listConversations()).toEqual(conversationsBefore);
    expect(listLogs()).toEqual(logsBefore);
    expect(llmMocks.complete).not.toHaveBeenCalled();
  });

  it.each(routes)('rejects non-object JSON on $name', async (route) => {
    const response = await route.post(rawRequest(route.path, '[]', 'application/json'));

    expect(response.status).toBe(400);
    expect(llmMocks.complete).not.toHaveBeenCalled();
  });

  it.each(routes)('requires JSON content type on $name', async (route) => {
    const response = await route.post(rawRequest(route.path, '{}', 'text/plain'));

    expect(response.status).toBe(400);
    expect(llmMocks.complete).not.toHaveBeenCalled();
  });

  it('rejects a body above the request limit with 413', async () => {
    const response = await chatPost(
      rawRequest(
        '/api/chat',
        JSON.stringify({ branchId: 'root', content: 'x'.repeat(70_000) }),
        'application/json',
      ),
    );

    expect(response.status).toBe(413);
    expect(llmMocks.complete).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'blank branch selection',
      post: branchPost,
      path: '/api/branch',
      body: { parentId: 'root', selection: '   ' },
    },
    {
      name: 'blank branch question',
      post: branchPost,
      path: '/api/branch',
      body: { parentId: 'root', selection: 'topic', question: '' },
    },
    {
      name: 'oversized branch title',
      post: branchPost,
      path: '/api/branch',
      body: { parentId: 'root', selection: 'topic', title: 'x'.repeat(161) },
    },
    {
      name: 'unknown manual model',
      post: branchPost,
      path: '/api/branch',
      body: {
        parentId: 'root',
        selection: 'topic',
        mode: { mode: 'manual', model: 'unknown', effort: 'low' },
      },
    },
    {
      name: 'unknown effort',
      post: chatPost,
      path: '/api/chat',
      body: {
        branchId: 'root',
        content: 'hello',
        mode: { mode: 'manual', model: 'claude-haiku-4-5', effort: 'turbo' },
      },
    },
    {
      name: 'unknown pinned tier',
      post: chatPost,
      path: '/api/chat',
      body: { branchId: 'root', content: 'hello', pinnedTier: 'fastest' },
    },
    {
      name: 'blank chat content',
      post: chatPost,
      path: '/api/chat',
      body: { branchId: 'root', content: '\n\t' },
    },
    {
      name: 'non-boolean archive',
      post: mergePost,
      path: '/api/merge',
      body: { branchId: 'root', archive: 'yes' },
    },
    {
      name: 'blank conversation title',
      post: conversationPost,
      path: '/api/conversation',
      body: { title: ' ' },
    },
  ] as const)('rejects $name', async ({ post, path, body }) => {
    const response = await post(
      rawRequest(path, JSON.stringify(body), 'application/json; charset=utf-8'),
    );

    expect(response.status).toBe(400);
    expect(llmMocks.complete).not.toHaveBeenCalled();
  });
});
