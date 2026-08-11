import { persistenceErrorResponse } from '@/app/api/persistence-response';
import {
  abortApiTransaction,
  transactionAbortResponse,
} from '@/app/api/transaction-abort';
import { parseBranchRequest } from '@/lib/api-validation';
import { compileBriefWithMetadata } from '@/lib/compiler';
import type { CompletionEvent } from '@/lib/llm';
import { buildLog } from '@/lib/mock';
import { ProviderUnavailableError } from '@/lib/provider';
import {
  CompletionPipelineError,
  completeWithEscalation,
  routeWithMetadata,
} from '@/lib/router';
import {
  availableTokensFor,
  buildTree,
  getConversation,
  logInference,
  nextId,
  putConversation,
  transactStore,
  visibleContextFor,
} from '@/lib/store';
import { estimateTokens } from '@/lib/tokens';
import type {
  ApiError,
  BranchResponse,
  Conversation,
  Message,
  RoutingDecision,
} from '@/lib/types';

const ANSWER_SYSTEM_PROMPT =
  'You answer using only the compiled brief provided. It is deliberately minimal and self-contained. If the brief genuinely lacks what you need, say so plainly rather than guessing.';

export async function POST(request: Request): Promise<Response> {
  const parsedRequest = await parseBranchRequest(request);
  if (!parsedRequest.ok) {
    return Response.json({ error: parsedRequest.error } satisfies ApiError, {
      status: parsedRequest.status,
    });
  }
  const body = parsedRequest.value;

  try {
    const transaction = await transactStore(async () => {
      const parent = getConversation(body.parentId);
      if (!parent) {
        abortApiTransaction({ error: `unknown parent ${body.parentId}` }, 404);
      }
      const parentContext = visibleContextFor(parent.id);
      if (!parentContext) {
        abortApiTransaction({ error: 'parent context unavailable' }, 500);
      }

      const branchId = nextId('branch');
      const question = body.question ?? '';
      const availableTokens = availableTokensFor(parent.id);
      const compiled = await compileBriefWithMetadata({
        briefId: nextId('brief'),
        branchId,
        parentContext,
        selection: body.selection,
        question,
        availableTokens,
      });
      let messages: Message[] = [];
      let routing: RoutingDecision | undefined;
      let answer: Message | undefined;
      let routed: Awaited<ReturnType<typeof routeWithMetadata>> | undefined;
      let answered: Awaited<ReturnType<typeof completeWithEscalation>> | undefined;

      if (question) {
        const questionTokens = estimateTokens(question);
        try {
          routed = await routeWithMetadata({
            question,
            brief: compiled.brief,
            contextTokens: compiled.brief.briefTokens + questionTokens,
            mode: body.mode,
          });
        } catch (error: unknown) {
          if (!(error instanceof ProviderUnavailableError)) throw error;
          logFailedBranchInference(branchId, compiled.compiler);
          return { kind: 'provider-unavailable' as const };
        }

        try {
          answered = await completeWithEscalation({
            routing: routed.routing,
            systemPrompt: ANSWER_SYSTEM_PROMPT,
            userPrompt: `${compiled.brief.markdown}\n\n---\n${question}`,
          });
        } catch (error: unknown) {
          const cause = error instanceof CompletionPipelineError ? error.cause : error;
          if (!(cause instanceof ProviderUnavailableError)) throw error;
          logFailedBranchInference(
            branchId,
            compiled.compiler,
            routed.classifier,
            error instanceof CompletionPipelineError ? error.attempts : [],
          );
          return { kind: 'provider-unavailable' as const };
        }
      }

      const { brief } = compiled;
      logInference(buildLog({ branchId, purpose: 'compile', ...compiled.compiler }));
      if (question && routed && answered) {
        routing = answered.routing;
        answer = {
          id: nextId('msg'),
          role: 'assistant',
          content: answered.text,
          routing,
          createdAt: new Date().toISOString(),
        };
        messages = [
          {
            id: nextId('msg'),
            role: 'user',
            content: question,
            createdAt: new Date().toISOString(),
          },
          answer,
        ];
        if (routed.classifier) {
          logInference(buildLog({ branchId, purpose: 'classify', ...routed.classifier }));
        }
        const finalAttempt = answered.attempts.length - 1;
        for (const [index, attempt] of answered.attempts.entries()) {
          logInference(
            buildLog({
              branchId,
              purpose: 'chat',
              ...attempt,
              baselineInputTokens:
                index === finalAttempt ? brief.availableTokens + estimateTokens(question) : 0,
              escalated: answered.attempts.length > 1,
              overridden: routing.overridden,
            }),
          );
        }
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
      const node = buildTree().find((candidate) => candidate.id === branchId);
      if (!node) {
        abortApiTransaction({ error: 'branch node missing after write' }, 500);
      }
      const response: BranchResponse = { node, conversation, brief, message: answer, routing };
      return { kind: 'success' as const, response };
    });

    if (transaction.kind === 'provider-unavailable') return providerUnavailable();
    return Response.json(transaction.response);
  } catch (error: unknown) {
    const abortResponse = transactionAbortResponse(error);
    if (abortResponse) return abortResponse;
    const persistenceResponse = persistenceErrorResponse(error);
    if (persistenceResponse) return persistenceResponse;
    if (error instanceof ProviderUnavailableError) return providerUnavailable();
    throw error;
  }
}

function logFailedBranchInference(
  branchId: string,
  compiler: CompletionEvent,
  classifier?: CompletionEvent,
  attempts: CompletionEvent[] = [],
): void {
  logInference(buildLog({ branchId, purpose: 'compile', ...compiler }));
  if (classifier) {
    logInference(buildLog({ branchId, purpose: 'classify', ...classifier }));
  }
  for (const attempt of attempts) {
    logInference(buildLog({ branchId, purpose: 'chat', ...attempt }));
  }
}

function providerUnavailable(): Response {
  return Response.json(
    { error: 'inference provider unavailable', code: 'PROVIDER_UNAVAILABLE' } satisfies ApiError,
    { status: 502 },
  );
}
