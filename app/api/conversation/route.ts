import { persistenceErrorResponse } from '@/app/api/persistence-response';
import {
  abortApiTransaction,
  transactionAbortResponse,
} from '@/app/api/transaction-abort';
import { parseConversationRequest } from '@/lib/api-validation';
import {
  buildTree,
  getConversation,
  nextId,
  putConversation,
  rootId,
  transactStore,
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
export async function POST(request: Request): Promise<Response> {
  const parsedRequest = await parseConversationRequest(request);
  if (!parsedRequest.ok) {
    return Response.json({ error: parsedRequest.error } satisfies ApiError, {
      status: parsedRequest.status,
    });
  }
  const body = parsedRequest.value;

  try {
    const response = await transactStore<NewConversationResponse>(() => {
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
      const node = buildTree().find((candidate) => candidate.id === id);
      if (!node) abortApiTransaction({ error: 'conversation missing after write' }, 500);
      return { node, conversation };
    });
    return Response.json(response);
  } catch (error: unknown) {
    const abortResponse = transactionAbortResponse(error);
    if (abortResponse) return abortResponse;
    const response = persistenceErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
