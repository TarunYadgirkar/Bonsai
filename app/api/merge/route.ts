import { INTERNAL_TIER, complete, estimateTokens, messagesTokens } from '@bonsai/engine';
import { buildLog } from '@/lib/accounting';
import { MergeRequestSchema, apiError, apiRoute, persistenceError } from '@/lib/api';
import {
  appendInsight,
  commit,
  getConversation,
  loadWorkingSet,
  logInference,
  newId,
  updateConversation,
} from '@/lib/store';
import type { Conversation, Insight, MergeResponse } from '@/lib/types';

export const POST = apiRoute(MergeRequestSchema, async (body) => {
  const ws = await loadWorkingSet();
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

  const response: MergeResponse = {
    insight,
    parentId: branch.parentId,
    archived: archive,
    log,
  };
  return Response.json(response);
});

/**
 * The whole point of cherry-picking: one durable line, not a summary of the excursion.
 * Cheapest tier, per AGENTS.md rule 7 — we are demoing cost discipline.
 */
async function distill(branch: Conversation): Promise<string> {
  if (!branch.messages.length) return fallbackInsight(branch.brief?.selection ?? branch.title);

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
        content: `Branch topic: ${branch.brief?.selection ?? branch.title}\n\n${branch.messages
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
