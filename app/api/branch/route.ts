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
  flushLogs,
  getConversation,
  loadStore,
  logInference,
  nextId,
  putConversation,
  saveStore,
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

export async function POST(request: Request) {
  const parsedRequest = await parseBranchRequest(request);
  if (!parsedRequest.ok) {
    return Response.json({ error: parsedRequest.error } satisfies ApiError, {
      status: parsedRequest.status,
    });
  }
  const body = parsedRequest.value;

  await loadStore();
  const parent = getConversation(body.parentId);
  if (!parent) {
    return Response.json({ error: `unknown parent ${body.parentId}` } satisfies ApiError, {
      status: 404,
    });
  }
  const parentContext = visibleContextFor(parent.id);
  if (!parentContext) {
    return Response.json({ error: 'parent context unavailable' } satisfies ApiError, {
      status: 500,
    });
  }

  const branchId = nextId('branch');
  const question = body.question ?? '';
  const availableTokens = availableTokensFor(parent.id);

  let messages: Message[] = [];
  let routing: RoutingDecision | undefined;
  let answer: Message | undefined;
  let compiled: Awaited<ReturnType<typeof compileBriefWithMetadata>>;
  let routed: Awaited<ReturnType<typeof routeWithMetadata>> | undefined;
  let answered: Awaited<ReturnType<typeof completeWithEscalation>> | undefined;

  try {
    compiled = await compileBriefWithMetadata({
      briefId: nextId('brief'),
      branchId,
      parentContext,
      selection: body.selection,
      question,
      availableTokens,
    });
  } catch (error: unknown) {
    if (!(error instanceof ProviderUnavailableError)) throw error;
    return providerUnavailable();
  }

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
      await persistFailedBranchInference(branchId, compiled.compiler);
      return providerUnavailable();
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
      const completedAttempts =
        error instanceof CompletionPipelineError ? error.attempts : [];
      await persistFailedBranchInference(
        branchId,
        compiled.compiler,
        routed.classifier,
        ...completedAttempts,
      );
      return providerUnavailable();
    }
  }

  const { brief } = compiled;
  logInference(
    buildLog({
      branchId,
      purpose: 'compile',
      ...compiled.compiler,
    }),
  );

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
      { id: nextId('msg'), role: 'user', content: question, createdAt: new Date().toISOString() },
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

  const node = buildTree().find((n) => n.id === branchId);
  if (!node) {
    return Response.json({ error: 'branch node missing after write' } satisfies ApiError, {
      status: 500,
    });
  }

  await saveStore();
  await flushLogs();

  const response: BranchResponse = { node, conversation, brief, message: answer, routing };
  return Response.json(response);
}

async function persistFailedBranchInference(
  branchId: string,
  ...events: Array<CompletionEvent | undefined>
): Promise<void> {
  events.forEach((event, index) => {
    if (!event) return;
    const purpose = index === 0 ? 'compile' : index === 1 ? 'classify' : 'chat';
    logInference(buildLog({ branchId, purpose, ...event }));
  });
  await saveStore();
  await flushLogs();
}

function providerUnavailable(): Response {
  return Response.json({ error: 'inference provider unavailable' } satisfies ApiError, {
    status: 502,
  });
}
