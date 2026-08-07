import { complete } from '@/lib/llm';
import { MEMORY_USER_ID, writeInsight } from '@/lib/memory';
import { INTERNAL_TIER, buildLog, mockInsight } from '@/lib/mock';
import {
  appendInsight,
  getConversation,
  logInference,
  nextId,
  updateConversation,
} from '@/lib/store';
import { estimateTokens, messagesTokens } from '@/lib/tokens';
import type {
  ApiError,
  Conversation,
  Insight,
  MergeRequest,
  MergeResponse,
} from '@/lib/types';

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<MergeRequest>;
  if (!body.branchId) {
    return Response.json({ error: 'branchId is required' } satisfies ApiError, { status: 400 });
  }

  const branch = getConversation(body.branchId);
  if (!branch) {
    return Response.json({ error: `unknown branch ${body.branchId}` } satisfies ApiError, {
      status: 404,
    });
  }
  if (!branch.parentId) {
    return Response.json({ error: 'the root has no parent to merge into' } satisfies ApiError, {
      status: 400,
    });
  }

  const text = await distill(branch);

  // Durable write is best-effort: it never blocks the merge, and always mirrors locally.
  const memory = await writeInsight({
    userId: MEMORY_USER_ID,
    branchId: branch.id,
    text,
  });

  const insight: Insight = {
    id: nextId('insight'),
    branchId: branch.id,
    parentId: branch.parentId,
    text,
    createdAt: new Date().toISOString(),
    ...(memory.remote ? { memoryId: branch.id } : {}),
  };

  appendInsight(branch.parentId, insight);

  const archive = body.archive ?? true;
  if (archive) updateConversation(branch.id, (c) => ({ ...c, archived: true }));

  // The distiller reads the branch, not the parent — cheapest tier, per AGENTS.md rule 7.
  const inputTokens = messagesTokens(branch.messages);
  const log = logInference(
    buildLog({
      branchId: branch.id,
      purpose: 'merge',
      tier: INTERNAL_TIER,
      inputTokens,
      outputTokens: estimateTokens(text),
      baselineInputTokens: branch.brief?.availableTokens ?? inputTokens,
    }),
  );

  const response: MergeResponse = {
    insight,
    parentId: branch.parentId,
    archived: archive,
    log,
  };
  return Response.json(response);
}

/**
 * The whole point of cherry-picking: one durable line, not a summary of the excursion.
 * Cheapest tier, per AGENTS.md rule 7 — we are demoing cost discipline.
 */
async function distill(branch: Conversation): Promise<string> {
  if (!branch.messages.length) return mockInsight(branch.brief?.selection ?? branch.title);

  const result = await complete({
    tier: INTERNAL_TIER,
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
  return line || mockInsight(branch.brief?.selection ?? branch.title);
}
