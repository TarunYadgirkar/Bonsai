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
export type ParsedContextSource = Pick<ContextSource, 'kind' | 'sourceId' | 'content'>;

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

export function renderContextSource(source: ParsedContextSource): string {
  const content = JSON.stringify(source.content)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `[source:${source.kind}:${source.sourceId}]\n${content}`;
}

export function parseContextSources(markdown: string): ParsedContextSource[] {
  const sources: ParsedContextSource[] = [];
  const marker = /^\[source:([^:\]\r\n]+):([^\]\r\n]+)\]\r?\n(.*)$/gm;
  for (const match of markdown.matchAll(marker)) {
    if (!isContextSourceKind(match[1])) continue;
    try {
      const content = JSON.parse(match[3]) as unknown;
      if (typeof content === 'string') {
        sources.push({ kind: match[1], sourceId: match[2], content });
      }
    } catch {
      continue;
    }
  }
  return sources;
}

function isContextSourceKind(value: string): value is ContextSource['kind'] {
  return (
    value === 'profile' ||
    value === 'brief' ||
    value === 'message' ||
    value === 'insight' ||
    value === 'selection' ||
    value === 'question'
  );
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
  const markdown = sources.map(renderContextSource).join('\n\n');

  return {
    markdown,
    sources,
    tokens: estimateTokens(markdown),
  };
}
