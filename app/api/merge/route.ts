import { parseMergeRequest } from '@/lib/api-validation';
import { persistenceErrorResponse } from '@/app/api/persistence-response';
import {
  abortApiTransaction,
  transactionAbortResponse,
} from '@/app/api/transaction-abort';
import { complete } from '@/lib/llm';
import type { CompleteResult } from '@/lib/llm';
import { INTERNAL_TIER, buildLog } from '@/lib/mock';
import { ProviderUnavailableError } from '@/lib/provider';
import {
  appendInsight,
  getConversation,
  logInference,
  nextId,
  transactStore,
  updateConversation,
  visibleContextFor,
} from '@/lib/store';
import type {
  ApiError,
  Conversation,
  Insight,
  MergeResponse,
} from '@/lib/types';

export async function POST(request: Request): Promise<Response> {
  const parsedRequest = await parseMergeRequest(request);
  if (!parsedRequest.ok) {
    return Response.json({ error: parsedRequest.error } satisfies ApiError, {
      status: parsedRequest.status,
    });
  }
  const body = parsedRequest.value;

  try {
    const transaction = await transactStore(async () => {
      const branch = getConversation(body.branchId);
      if (!branch) {
        abortApiTransaction({ error: `unknown branch ${body.branchId}` }, 404);
      }
      if (!branch.parentId) {
        abortApiTransaction({ error: 'the root has no parent to merge into' }, 400);
      }
      const context = visibleContextFor(branch.id);
      if (!context) {
        abortApiTransaction({ error: 'branch context unavailable' }, 500);
      }
      const distillation = await distill(branch, context.markdown);
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
        return {
          kind: 'error' as const,
          status: 502,
          error: 'merge produced no durable insight',
        };
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
      if (archive) updateConversation(branch.id, (conversation) => ({ ...conversation, archived: true }));
      const log = logInference(
        buildLog({
          branchId: branch.id,
          purpose: 'merge',
          completion: distillation.completion,
          status: 'succeeded',
        }),
      );
      const response: MergeResponse = {
        insight,
        parentId: branch.parentId,
        archived: archive,
        log,
      };
      return { kind: 'success' as const, response };
    });
    if (transaction.kind === 'error') {
      return Response.json({ error: transaction.error } satisfies ApiError, {
        status: transaction.status,
      });
    }
    return Response.json(transaction.response);
  } catch (error: unknown) {
    const abortResponse = transactionAbortResponse(error);
    if (abortResponse) return abortResponse;
    const response = persistenceErrorResponse(error);
    if (response) return response;
    if (error instanceof ProviderUnavailableError) {
      return Response.json(
        {
          error: 'inference provider unavailable',
          code: 'PROVIDER_UNAVAILABLE',
        } satisfies ApiError,
        { status: 502 },
      );
    }
    throw error;
  }
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
