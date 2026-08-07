import {
  buildTree,
  flushLogs,
  getConversation,
  loadStore,
  nextId,
  putConversation,
  rootId,
  saveStore,
} from '@/lib/store';
import type { ApiError, Conversation, BranchNode } from '@/lib/types';

export const dynamic = 'force-dynamic';

export interface NewConversationRequest {
  title?: string;
}

export interface NewConversationResponse {
  node: BranchNode;
  conversation: Conversation;
}

/**
 * Start a fresh root conversation — a second tree, not a branch of the first.
 *
 * It carries the seeded profile so anything branched off it still compiles a brief that knows
 * who the user is; `parentId` is null, so it inherits no transcript and no tokens.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as NewConversationRequest;

  await loadStore();
  const id = nextId('conv');
  const seedProfile = getConversation(rootId())?.profile;

  const conversation: Conversation = {
    id,
    title: body.title?.trim() || 'New chat',
    parentId: null,
    ...(seedProfile ? { profile: seedProfile } : {}),
    messages: [],
    insights: [],
    pinnedTier: null,
    archived: false,
  };
  putConversation(conversation);

  const node = buildTree().find((n) => n.id === id);
  if (!node) {
    return Response.json({ error: 'conversation missing after write' } satisfies ApiError, {
      status: 500,
    });
  }

  await saveStore();
  await flushLogs();

  const response: NewConversationResponse = { node, conversation };
  return Response.json(response);
}
