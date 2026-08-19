import { INTERNAL_TIER, complete, estimateTokens, messagesTokens } from '@bonsai/engine';
import { buildLog } from '@/lib/accounting';
import { MergeRequestSchema, apiError, apiRoute, persistenceError } from '@/lib/api';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveSession, withSession } from '@/lib/session';
import {
  appendInsight,
  commit,
  getConversation,
  loadWorkingSet,
  logInference,
  newId,
  recordRoutingFeedback,
  updateConversation,
} from '@/lib/store';
import type { Conversation, Insight, MergeResponse } from '@/lib/types';

export const POST = apiRoute(MergeRequestSchema, async (body, request) => {
  const session = resolveSession(request);
  const limit = checkRateLimit(session.id, 'inference');
  if (!limit.ok) return apiError(`rate limit exceeded — retry in ${limit.retryAfterSeconds}s`, 429);
  const ws = await loadWorkingSet(session.id);
  const branch = getConversation(ws, body.branchId);
  if (!branch) return apiError(`unknown branch ${body.branchId}`, 404);
  if (!branch.parentId) return apiError('the root has no parent to merge into', 400);

  const text = await distill(branch);

  const insight: Insight = {
    id: newId('insight'),
    branchId: branch.id,
    parentId: branch.parentId,
    text,
    createdAt: new Date().toISOString(),
  };

  appendInsight(ws, branch.parentId, insight);

  const archive = body.archive ?? true;
  if (archive) updateConversation(ws, branch.id, (c) => ({ ...c, archived: true }));

  // The distiller reads the branch, not the parent — cheapest tier, per AGENTS.md rule 7.
  const inputTokens = messagesTokens(branch.messages);
  const log = logInference(
    ws,
    buildLog({
      branchId: branch.id,
      purpose: 'merge',
      tier: INTERNAL_TIER,
      inputTokens,
      outputTokens: estimateTokens(text),
      baselineInputTokens: branch.brief?.availableTokens ?? inputTokens,
    }),
  );

  if ((await commit(ws)) === 'failed') return persistenceError();

  // A merged branch is a kept answer: the tier that produced its last auto reply was sufficient.
  const kept = lastAuto(branch);
  if (kept) {
    await recordRoutingFeedback(session.id, {
      kind: 'merge',
      classifiedTier: kept.tier,
      questionKind: kept.kind,
    });
  }

  const response: MergeResponse = {
    insight,
    parentId: branch.parentId,
    archived: archive,
    log,
  };
  return withSession(Response.json(response), session);
});

/** The auto-router's last decision on this branch (tier + question kind; ignoring manual picks). */
function lastAuto(conversation: Conversation) {
  for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
    const r = conversation.messages[i].routing;
    if (r && !r.overridden) return { tier: r.tier, kind: r.kind };
  }
  return null;
}

/**
 * The whole point of cherry-picking: one durable line, not a summary of the excursion.
 * Cheapest tier, per AGENTS.md rule 7 — we are demoing cost discipline.
 */
/** A long-lived branch must not grow the distill prompt without bound. */
const DISTILL_MAX_TURNS = 40;

async function distill(branch: Conversation): Promise<string> {
  if (!branch.messages.length) return fallbackInsight(branch.brief?.selection ?? branch.title);
  const turns = branch.messages.slice(-DISTILL_MAX_TURNS);

  const result = await complete({
    tier: INTERNAL_TIER,
    purpose: 'merge',
    maxTokens: 120,
    messages: [
      {
        role: 'system',
        content:
          'Extract the single durable conclusion from this branch — the one thing the parent conversation should learn. One sentence, under 20 words, self-contained with referents resolved. No preamble, no quotes, just the sentence.',
      },
      {
        role: 'user',
        content: `Branch topic: ${branch.brief?.selection ?? branch.title}\n\n${turns
          .map((m) => `${m.role}: ${m.content}`)
          .join('\n\n')}`,
      },
    ],
  });

  const line = result.text.trim().split('\n')[0]?.replace(/^["']|["']$/g, '') ?? '';
  return line || fallbackInsight(branch.brief?.selection ?? branch.title);
}

/** Last resort when the branch is empty or the distiller returns nothing. */
function fallbackInsight(topic: string): string {
  return `No durable conclusion reached on ${topic || 'this branch'}.`;
}
