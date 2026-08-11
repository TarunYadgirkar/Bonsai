import { parseChatRequest } from '@/lib/api-validation';
import { buildLog } from '@/lib/mock';
import { ProviderUnavailableError } from '@/lib/provider';
import {
  CompletionPipelineError,
  completeWithEscalation,
  routeWithMetadata,
} from '@/lib/router';
import {
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
import { estimateTokens } from '@/lib/tokens';
import type { ApiError, ChatResponse } from '@/lib/types';

const ANSWER_SYSTEM_PROMPT =
  'You answer using only the context provided. If it is a compiled brief, it is deliberately minimal and self-contained; if it genuinely lacks what you need, say so plainly rather than guessing.';

export async function POST(request: Request) {
  const parsedRequest = await parseChatRequest(request);
  if (!parsedRequest.ok) {
    return Response.json({ error: parsedRequest.error } satisfies ApiError, {
      status: parsedRequest.status,
    });
  }
  const body = parsedRequest.value;

  await loadStore();
  const conversation = getConversation(body.branchId);
  if (!conversation) {
    return Response.json({ error: `unknown branch ${body.branchId}` } satisfies ApiError, {
      status: 404,
    });
  }

  const context = visibleContextFor(conversation.id);
  if (!context) {
    return Response.json({ error: 'conversation context unavailable' } satisfies ApiError, {
      status: 500,
    });
  }

  const questionTokens = estimateTokens(body.content);
  const contextTokens = context.tokens + questionTokens;
  const baselineInputTokens = availableTokensFor(conversation.id) + questionTokens;
  const pinnedTier = body.pinnedTier === undefined ? conversation.pinnedTier : body.pinnedTier;
  let routed: Awaited<ReturnType<typeof routeWithMetadata>>;
  try {
    routed = await routeWithMetadata({
      question: body.content,
      brief: conversation.brief,
      contextTokens,
      pinnedTier,
      mode: body.mode,
    });
  } catch (error: unknown) {
    if (!(error instanceof ProviderUnavailableError)) throw error;
    return providerUnavailable();
  }

  let result: Awaited<ReturnType<typeof completeWithEscalation>>;
  try {
    result = await completeWithEscalation({
      routing: routed.routing,
      systemPrompt: ANSWER_SYSTEM_PROMPT,
      userPrompt: `${context.markdown}\n\n---\n${body.content}`,
    });
  } catch (error: unknown) {
    const cause = error instanceof CompletionPipelineError ? error.cause : error;
    if (!(cause instanceof ProviderUnavailableError)) throw error;
    if (routed.classifier) {
      logInference(buildLog({ branchId: conversation.id, purpose: 'classify', ...routed.classifier }));
    }
    if (error instanceof CompletionPipelineError) {
      for (const attempt of error.attempts) {
        logInference(
          buildLog({
            branchId: conversation.id,
            purpose: 'chat',
            ...attempt,
            escalated: true,
            overridden: routed.routing.overridden,
          }),
        );
      }
    }
    await saveStore();
    await flushLogs();
    return providerUnavailable();
  }

  const userMessage = {
    id: nextId('msg'),
    role: 'user' as const,
    content: body.content,
    createdAt: new Date().toISOString(),
  };

  const message = {
    id: nextId('msg'),
    role: 'assistant' as const,
    content: result.text,
    routing: result.routing,
    createdAt: new Date().toISOString(),
  };
  updateConversation(conversation.id, (current) => ({
    ...current,
    messages: [...current.messages, userMessage, message],
  }));

  if (routed.classifier) {
    logInference(buildLog({ branchId: conversation.id, purpose: 'classify', ...routed.classifier }));
  }
  let log: ReturnType<typeof logInference> | undefined;
  const finalAttempt = result.attempts.length - 1;
  for (const [index, attempt] of result.attempts.entries()) {
    const recorded = logInference(
      buildLog({
        branchId: conversation.id,
        purpose: 'chat',
        ...attempt,
        baselineInputTokens: index === finalAttempt ? baselineInputTokens : 0,
        escalated: result.attempts.length > 1,
        overridden: result.routing.overridden,
      }),
    );
    if (index === finalAttempt) log = recorded;
  }
  if (!log) {
    return Response.json({ error: 'answer completion missing' } satisfies ApiError, { status: 502 });
  }

  await saveStore();
  await flushLogs();

  const response: ChatResponse = {
    branchId: conversation.id,
    message,
    routing: result.routing,
    log,
  };
  return Response.json(response);
}

function providerUnavailable(): Response {
  return Response.json({ error: 'inference provider unavailable' } satisfies ApiError, {
    status: 502,
  });
}
