import {
  completeWithEscalation,
  renderChatContext,
  route,
  widenedChatContext,
} from '@bonsai/engine';
import { buildLog } from '@/lib/accounting';
import { ChatRequestSchema, apiError, apiRoute, persistenceError } from '@/lib/api';
import { resolveSession, withSession } from '@/lib/session';
import {
  appendMessage,
  availableTokensFor,
  commit,
  getConversation,
  loadPopulationPrior,
  loadProfile,
  loadWorkingSet,
  logInference,
  newId,
  recordRoutingFeedback,
  updateConversation,
} from '@/lib/store';
import type { ChatResponse, Conversation, QuestionKind, Tier } from '@/lib/types';

/** Most recent auto-router decision on this branch (ignoring manual/pinned picks). */
function lastAuto(conversation: Conversation): { tier: Tier; kind?: QuestionKind } | null {
  for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
    const r = conversation.messages[i].routing;
    if (r && !r.overridden) return { tier: r.tier, kind: r.kind };
  }
  return null;
}

const ANSWER_SYSTEM_PROMPT =
  'You answer using only the context provided. If it is a compiled brief, it is deliberately minimal and self-contained; if it genuinely lacks what you need, say so plainly rather than guessing.';

export const POST = apiRoute(ChatRequestSchema, async (body, request) => {
  const session = resolveSession(request);
  const ws = await loadWorkingSet(session.id);
  let conversation = getConversation(ws, body.branchId);
  if (!conversation) return apiError(`unknown branch ${body.branchId}`, 404);

  // A manual pick pins the branch; an explicit switch back to auto unpins it — and both take
  // effect THIS turn, so `conversation` is rebound to the updated node before routing reads its
  // pin. Pin-per-branch (not per message) also keeps the provider prompt cache warm.
  if (body.mode?.mode === 'manual') {
    conversation =
      updateConversation(ws, conversation.id, (c) => ({ ...c, pinnedMode: body.mode })) ??
      conversation;
  } else if (body.mode?.mode === 'auto') {
    conversation =
      updateConversation(ws, conversation.id, (c) => ({ ...c, pinnedMode: null })) ?? conversation;
  }

  // The auto decision this branch last landed on, captured before the new turn is appended — the
  // baseline (tier + question kind) a manual pick this turn is judged an up/down override against.
  const priorAuto = lastAuto(conversation);

  appendMessage(ws, conversation.id, {
    id: newId('msg'),
    role: 'user',
    content: body.content,
    createdAt: new Date().toISOString(),
  });

  // Context = brief + merged insights + own turns (root: transcript + insights). The question
  // rides after the divider, so `conversation` staying pre-append is deliberate.
  const { context, contextTokens } = renderChatContext(conversation);

  const pinnedTier = body.pinnedTier ?? conversation.pinnedTier;
  const [profile, population] = await Promise.all([
    loadProfile(session.id),
    loadPopulationPrior(),
  ]);
  const initial = await route({
    question: body.content,
    brief: conversation.brief,
    contextTokens,
    pinnedTier,
    mode: body.mode,
    pinnedMode: conversation.pinnedMode,
    profile,
    population: population.prior ?? undefined,
  });

  const result = await completeWithEscalation({
    routing: initial,
    systemPrompt: ANSWER_SYSTEM_PROMPT,
    userPrompt: `${context}\n\n---\n${body.content}`,
    widen: () => {
      const wider = widenedChatContext(conversation, (id) => getConversation(ws, id));
      return wider
        ? { userPrompt: `${wider.context}\n\n---\n${body.content}`, addedTokens: wider.addedTokens }
        : null;
    },
  });

  const message = {
    id: newId('msg'),
    role: 'assistant' as const,
    content: result.text,
    routing: result.routing,
    createdAt: new Date().toISOString(),
  };
  appendMessage(ws, conversation.id, message);

  const log = logInference(
    ws,
    buildLog({
      branchId: conversation.id,
      purpose: 'chat',
      tier: result.routing.tier,
      model: result.routing.model,
      effort: result.routing.effort,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estCostUsd: result.routing.estCostUsd,
      baselineInputTokens: conversation.brief
        ? conversation.brief.availableTokens + contextTokens
        : contextTokens + availableTokensFor(ws, conversation.parentId),
      escalated: result.routing.escalated,
      overridden: result.routing.overridden,
      // Live provider set servedBy; the mock never does — so this is the measured/estimated flag.
      measured: Boolean(result.routing.servedBy),
    }),
  );

  if ((await commit(ws)) === 'failed') return persistenceError();

  // Learn from what just happened. An escalation means the classifier started too low — credited
  // to the tier the CLASSIFIER chose, not the tier a learned prior shifted it to, so a bad
  // down-shift's own escalations become the counter-evidence that unwinds it.
  if (result.routing.escalated) {
    await recordRoutingFeedback(session.id, {
      kind: 'escalation',
      classifiedTier: initial.classifiedTier ?? initial.tier,
      questionKind: initial.kind,
    });
  }
  // A manual pick that moved off the branch's last auto tier is ONE labeled up/down correction.
  // Gate on a pick actually made THIS turn — an inherited server-side pin re-reports overridden
  // on every following message, and counting each would fabricate a "consistent pattern" from a
  // single decision (and poison the shared community prior).
  const pickedThisTurn = body.mode?.mode === 'manual' || body.pinnedTier != null;
  if (pickedThisTurn && priorAuto && priorAuto.tier !== result.routing.tier) {
    await recordRoutingFeedback(session.id, {
      kind: 'override',
      classifiedTier: priorAuto.tier,
      chosenTier: result.routing.tier,
      questionKind: priorAuto.kind,
    });
  }

  const response: ChatResponse = {
    branchId: conversation.id,
    message,
    routing: result.routing,
    log,
  };
  return withSession(Response.json(response), session);
});
