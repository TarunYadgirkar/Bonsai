import {
  INTERNAL_TIER,
  assemblePath,
  compileBrief,
  completeWithEscalation,
  estimateTokens,
  profileFor,
  route,
  widenedChatContext,
} from '@bonsai/engine';
import { buildLog } from '@/lib/accounting';
import { BranchRequestSchema, apiError, apiRoute, persistenceError } from '@/lib/api';
import {
  availableTokensFor,
  buildTree,
  commit,
  getConversation,
  loadWorkingSet,
  logInference,
  newId,
  putConversation,
} from '@/lib/store';
import type { BranchResponse, Conversation, Message, RoutingDecision } from '@/lib/types';

const ANSWER_SYSTEM_PROMPT =
  'You answer using only the compiled brief provided. It is deliberately minimal and self-contained. If the brief genuinely lacks what you need, say so plainly rather than guessing.';

export const POST = apiRoute(BranchRequestSchema, async (body) => {
  const ws = await loadWorkingSet();
  const parent = getConversation(ws, body.parentId);
  if (!parent) return apiError(`unknown parent ${body.parentId}`, 404);

  const byId = (id: string) => getConversation(ws, id);
  const branchId = newId('branch');
  const question = body.question ?? '';
  const availableTokens = availableTokensFor(ws, parent.id) + estimateTokens(body.selection);

  // Compile off the assembled path: the parent's own brief + merged insights + the transcript
  // up to the fork anchor. Referents an ancestor already resolved arrive pre-resolved.
  const path = assemblePath({
    parent,
    byId,
    anchorMessageId: body.anchorMessageId,
  });
  const compiled = await compileBrief({
    briefId: newId('brief'),
    branchId,
    pathMarkdown: path.markdown,
    profile: profileFor(parent, byId),
    selection: body.selection,
    question,
    availableTokens,
    anchorMessageId: body.anchorMessageId,
  });
  const brief = compiled.brief;

  logInference(
    ws,
    buildLog({
      branchId,
      purpose: 'compile',
      tier: INTERNAL_TIER,
      model: compiled.usage.model,
      inputTokens: compiled.usage.inputTokens,
      outputTokens: compiled.usage.outputTokens,
      baselineInputTokens: availableTokens,
    }),
  );

  const conversation: Conversation = {
    id: branchId,
    title: body.title ?? body.selection.slice(0, 48),
    parentId: parent.id,
    messages: [],
    brief,
    insights: [],
    pinnedTier: null,
    pinnedMode: body.mode?.mode === 'manual' ? body.mode : null,
    archived: false,
  };

  let routing: RoutingDecision | undefined;
  let answer: Message | undefined;

  if (question) {
    const initial = await route({
      question,
      brief,
      contextTokens: brief.briefTokens,
      mode: body.mode,
    });
    const result = await completeWithEscalation({
      routing: initial,
      systemPrompt: ANSWER_SYSTEM_PROMPT,
      userPrompt: `${brief.markdown}\n\n---\n${question}`,
      widen: () => {
        const wider = widenedChatContext(conversation, byId);
        return wider
          ? { userPrompt: `${wider.context}\n\n---\n${question}`, addedTokens: wider.addedTokens }
          : null;
      },
    });
    routing = result.routing;
    answer = {
      id: newId('msg'),
      role: 'assistant',
      content: result.text,
      routing,
      createdAt: new Date().toISOString(),
    };
    conversation.messages = [
      { id: newId('msg'), role: 'user', content: question, createdAt: new Date().toISOString() },
      answer,
    ];
    logInference(
      ws,
      buildLog({
        branchId,
        purpose: 'chat',
        tier: routing.tier,
        model: routing.model,
        effort: routing.effort,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        baselineInputTokens: brief.availableTokens,
        escalated: routing.escalated,
      }),
    );
  }

  putConversation(ws, conversation);

  const node = buildTree(ws).find((n) => n.id === branchId);
  if (!node) return apiError('branch node missing after write', 500);

  if ((await commit(ws)) === 'failed') return persistenceError();

  const response: BranchResponse = { node, conversation, brief, message: answer, routing };
  return Response.json(response);
});
