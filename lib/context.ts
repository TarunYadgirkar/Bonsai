import { estimateTokens } from './tokens';
import type {
  AssembledContext,
  ContextBrief,
  ContextSource,
  Conversation,
  Insight,
  Message,
} from './types';

export type ConversationLookup = (id: string) => Conversation | undefined;

function profileSource(conversation: Conversation): ContextSource {
  const profile = conversation.profile!;
  return {
    kind: 'profile',
    conversationId: conversation.id,
    sourceId: `profile:${conversation.id}`,
    content: [
      `Name: ${profile.name}`,
      `Context: ${profile.context}`,
      `Goals: ${profile.goals.join('; ')}`,
    ].join('\n'),
  };
}

function briefSource(conversationId: string, brief: ContextBrief): ContextSource {
  return {
    kind: 'brief',
    conversationId,
    sourceId: brief.id,
    content: brief.markdown,
  };
}

function messageSource(conversationId: string, message: Message): ContextSource {
  return {
    kind: 'message',
    conversationId,
    sourceId: message.id,
    content: `${message.role}: ${message.content}`,
  };
}

function insightSource(conversationId: string, insight: Insight): ContextSource {
  return {
    kind: 'insight',
    conversationId,
    sourceId: insight.id,
    content: insight.text,
  };
}

function activeInsightSources(conversation: Conversation): ContextSource[] {
  return conversation.insights
    .filter((insight) => insight.active !== false)
    .map((insight) => insightSource(conversation.id, insight));
}

function renderSource(source: ContextSource): string {
  return `[source:${source.kind}:${source.sourceId}]\n${source.content}`;
}

export function assembleVisibleContext(
  conversationId: string,
  lookup: ConversationLookup,
): AssembledContext {
  const conversation = lookup(conversationId);
  if (!conversation) throw new Error(`unknown conversation ${conversationId}`);

  const sources: ContextSource[] =
    conversation.parentId === null
      ? [
          ...(conversation.profile ? [profileSource(conversation)] : []),
          ...conversation.messages.map((message) => messageSource(conversation.id, message)),
          ...activeInsightSources(conversation),
        ]
      : [
          ...(conversation.brief ? [briefSource(conversation.id, conversation.brief)] : []),
          ...conversation.messages.map((message) => messageSource(conversation.id, message)),
          ...activeInsightSources(conversation),
        ];
  const markdown = sources.map(renderSource).join('\n\n');

  return {
    markdown,
    sources,
    tokens: estimateTokens(markdown),
  };
}
