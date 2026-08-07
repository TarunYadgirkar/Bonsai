import { compileBrief } from '@/lib/compiler';
import { MEMORY_USER_ID, searchMemories } from '@/lib/memory';
import { buildLog } from '@/lib/mock';
import { INTERNAL_TIER } from '@/lib/models';
import { completeWithEscalation, route } from '@/lib/router';
import {
  availableTokensFor,
  buildTree,
  getConversation,
  loadStore,
  logInference,
  nextId,
  putConversation,
  saveStore,
} from '@/lib/store';
import { estimateTokens } from '@/lib/tokens';
import type {
  ApiError,
  BranchRequest,
  BranchResponse,
  Conversation,
  Message,
  RoutingDecision,
  UserProfile,
} from '@/lib/types';

const ANSWER_SYSTEM_PROMPT =
  'You answer using only the compiled brief provided. It is deliberately minimal and self-contained. If the brief genuinely lacks what you need, say so plainly rather than guessing.';

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<BranchRequest>;
  if (!body.parentId || !body.selection) {
    return Response.json({ error: 'parentId and selection are required' } satisfies ApiError, {
      status: 400,
    });
  }

  await loadStore();
  const parent = getConversation(body.parentId);
  if (!parent) {
    return Response.json({ error: `unknown parent ${body.parentId}` } satisfies ApiError, {
      status: 404,
    });
  }

  const branchId = nextId('branch');
  const question = body.question ?? '';
  const availableTokens = availableTokensFor(parent.id) + estimateTokens(body.selection);

  // Per-branch retrieval: what the branch is FOR decides which memories it deserves.
  const memories = await searchMemories({
    query: question || body.selection,
    userId: MEMORY_USER_ID,
  });

  const brief = await compileBrief({
    briefId: nextId('brief'),
    branchId,
    parentMessages: parent.messages,
    profile: profileFor(parent),
    selection: body.selection,
    question,
    memories,
    availableTokens,
  });

  logInference(
    buildLog({
      branchId,
      purpose: 'compile',
      tier: INTERNAL_TIER,
      inputTokens: availableTokens,
      outputTokens: brief.briefTokens,
      baselineInputTokens: availableTokens,
    }),
  );

  let messages: Message[] = [];
  let routing: RoutingDecision | undefined;
  let answer: Message | undefined;

  if (question) {
    const initial = await route({ question, brief, contextTokens: brief.briefTokens });
    const result = await completeWithEscalation({
      routing: initial,
      systemPrompt: ANSWER_SYSTEM_PROMPT,
      userPrompt: `${brief.markdown}\n\n---\n${question}`,
    });
    routing = result.routing;
    answer = {
      id: nextId('msg'),
      role: 'assistant',
      content: result.text,
      routing,
      createdAt: new Date().toISOString(),
    };
    messages = [
      { id: nextId('msg'), role: 'user', content: question, createdAt: new Date().toISOString() },
      answer,
    ];
    logInference(
      buildLog({
        branchId,
        purpose: 'chat',
        tier: routing.tier,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        baselineInputTokens: brief.availableTokens,
        escalated: routing.escalated,
      }),
    );
  }

  const conversation: Conversation = {
    id: branchId,
    title: body.title ?? body.selection.slice(0, 48),
    parentId: parent.id,
    messages,
    brief,
    insights: [],
    pinnedTier: null,
    archived: false,
  };
  putConversation(conversation);

  const node = buildTree().find((n) => n.id === branchId);
  if (!node) {
    return Response.json({ error: 'branch node missing after write' } satisfies ApiError, {
      status: 500,
    });
  }

  await saveStore();

  const response: BranchResponse = { node, conversation, brief, message: answer, routing };
  return Response.json(response);
}

/** Only the root carries the profile; a branch off a branch still needs it. */
function profileFor(conversation: Conversation): UserProfile | undefined {
  let cursor: Conversation | undefined = conversation;
  while (cursor) {
    if (cursor.profile) return cursor.profile;
    cursor = cursor.parentId ? getConversation(cursor.parentId) : undefined;
  }
  return undefined;
}
