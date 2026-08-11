import { parseMergeRequest } from '@/lib/api-validation';
import { complete } from '@/lib/llm';
import type { CompleteResult } from '@/lib/llm';
import { INTERNAL_TIER, buildLog } from '@/lib/mock';
import { ProviderUnavailableError } from '@/lib/provider';
import {
  appendInsight,
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
  MergeResponse,
} from '@/lib/types';

export async function POST(request: Request) {
  const parsedRequest = await parseMergeRequest(request);
  if (!parsedRequest.ok) {
    return Response.json({ error: parsedRequest.error } satisfies ApiError, {
      status: parsedRequest.status,
    });
  }
  const body = parsedRequest.value;

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

  let distillation: Awaited<ReturnType<typeof distill>>;
  try {
    distillation = await distill(branch, context.markdown);
  } catch (error: unknown) {
    if (!(error instanceof ProviderUnavailableError)) throw error;
    return Response.json({ error: 'inference provider unavailable' } satisfies ApiError, {
      status: 502,
    });
  }
  const { text } = distillation;

  if (!text) {
    logInference(
      buildLog({
        branchId: branch.id,
        purpose: 'merge',
        completion: distillation.completion,
        status: 'failed',
      }),
    );
    await saveStore();
    await flushLogs();
    return Response.json({ error: 'merge produced no durable insight' } satisfies ApiError, {
      status: 502,
    });
  }

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
      completion: distillation.completion,
      status: 'succeeded',
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
): Promise<{ text: string; completion: CompleteResult }> {
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
  return { text: line, completion: result };
}
