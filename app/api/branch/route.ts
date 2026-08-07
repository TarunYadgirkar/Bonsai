import { MEMORY_USER_ID, type MemoryHit, searchMemories } from '@/lib/memory';
import { buildLog, mockBrief, mockMessage, mockRoute } from '@/lib/mock';
import { buildTree, getConversation, logInference, nextId, putConversation } from '@/lib/store';
import { estimateTokens, prunedPct } from '@/lib/tokens';
import type {
  ApiError,
  BranchRequest,
  BranchResponse,
  Conversation,
  ContextBrief,
  Message,
  RoutingDecision,
} from '@/lib/types';

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<BranchRequest>;
  if (!body.parentId || !body.selection) {
    return Response.json({ error: 'parentId and selection are required' } satisfies ApiError, {
      status: 400,
    });
  }

  const parent = getConversation(body.parentId);
  if (!parent) {
    return Response.json({ error: `unknown parent ${body.parentId}` } satisfies ApiError, {
      status: 404,
    });
  }

  const branchId = nextId('branch');
  const question = body.question ?? '';
  const base = mockBrief(branchId, parent.id, body.selection, question);

  // Per-branch memory recall — what the branch is FOR decides which memories it deserves.
  const hits = await searchMemories({
    query: question || body.selection,
    userId: MEMORY_USER_ID,
  });
  const brief = hits.length ? withMemory(base, hits) : base;

  let messages: Message[] = [];
  let routing: RoutingDecision | undefined;
  let answer: Message | undefined;

  if (question) {
    routing = mockRoute(question, brief.briefTokens, null);
    answer = mockMessage(routing.tier, question, routing);
    messages = [
      { id: nextId('msg'), role: 'user', content: question, createdAt: new Date().toISOString() },
      answer,
    ];
    logInference(
      buildLog({
        branchId,
        purpose: 'chat',
        tier: routing.tier,
        inputTokens: brief.briefTokens,
        outputTokens: estimateTokens(answer.content),
        baselineInputTokens: brief.availableTokens,
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

  const response: BranchResponse = { node, conversation, brief, message: answer, routing };
  return Response.json(response);
}

/** Folding memory in grows the brief, so the token math and pruned-% have to be recomputed. */
function withMemory(base: ContextBrief, hits: MemoryHit[]): ContextBrief {
  const markdown = `${base.markdown}\n\n## Recalled memory\n${hits
    .map((h) => `- ${h.text}`)
    .join('\n')}`;
  const briefTokens = estimateTokens(markdown);
  return {
    ...base,
    facts: [...base.facts, ...hits.map((h) => `Recalled: ${h.text}`)],
    markdown,
    briefTokens,
    prunedPct: prunedPct(base.availableTokens, briefTokens),
    memoryIds: hits.map((h) => h.id),
  };
}
