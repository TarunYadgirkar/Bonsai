import { complete } from '@/lib/llm';
import { INTERNAL_TIER, buildLog, mockInsight } from '@/lib/mock';
import {
  appendInsight,
  availableTokensFor,
  flushLogs,
  getConversation,
  loadStore,
  logInference,
  nextId,
  saveStore,
  updateConversation,
  visibleContextFor,
} from '@/lib/store';
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

  await loadStore();
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

  const context = visibleContextFor(branch.id);
  if (!context) {
    return Response.json({ error: 'branch context unavailable' } satisfies ApiError, {
      status: 500,
    });
  }

  const baselineInputTokens = availableTokensFor(branch.id);
  const distillation = await distill(branch, context.markdown);
  const { text } = distillation;

  const insight: Insight = {
    id: nextId('insight'),
    branchId: branch.id,
    parentId: branch.parentId,
    text,
    createdAt: new Date().toISOString(),
    sourceMessageIds: branch.messages.map((message) => message.id),
    active: true,
  };

  appendInsight(branch.parentId, insight);

  const archive = body.archive ?? true;
  if (archive) updateConversation(branch.id, (c) => ({ ...c, archived: true }));

  // The distiller reads the branch, not the parent — cheapest tier, per AGENTS.md rule 7.
  const log = logInference(
    buildLog({
      branchId: branch.id,
      purpose: 'merge',
      tier: INTERNAL_TIER,
      inputTokens: distillation.inputTokens,
      outputTokens: distillation.outputTokens,
      baselineInputTokens,
    }),
  );

  await saveStore();
  await flushLogs();

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
async function distill(
  branch: Conversation,
  contextMarkdown: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
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
        content: `Branch topic: ${branch.brief?.selection ?? branch.title}\n\n${contextMarkdown}`,
      },
    ],
  });

  const line =
    result.text.trim().split('\n')[0]?.replace(/^["']|["']$/g, '').trim() ?? '';
  const text = line || mockInsight(branch.brief?.selection ?? branch.title);
  return {
    text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}
