/**
 * Context compiler. Turns visible parent context into the smallest self-contained brief that
 * answers a branch's question.
 */
import { complete } from './llm';
import { renderContextSource } from './context';
import { INTERNAL_TIER } from './models';
import { estimateTokens, prunedPct } from './tokens';
import type {
  AssembledContext,
  ContextBrief,
  ContextSource,
  ContextSourceRef,
} from './types';

const MAX_FACTS = 8;
const MAX_FALLBACK_FACTS = 3;
const STOPWORDS = new Set(
  'a an and are as at be but by for from how i in is it of on or that the this to was what when where which who why with you your'
    .split(' '),
);

export interface CompileParams {
  briefId: string;
  branchId: string;
  parentContext: AssembledContext;
  selection: string;
  question: string;
  availableTokens: number;
}

interface CompilerFact {
  text: string;
  sourceIds: string[];
}

interface CompilerOutput {
  facts: CompilerFact[];
  excludedNote: string;
}

export async function compileBrief(params: CompileParams): Promise<ContextBrief> {
  const { briefId, branchId, selection, question, availableTokens } = params;
  const compilerSources = buildCompilerSources(params);
  const parsed = await runCompiler(compilerSources);
  const output = parseCompilerOutput(parsed, compilerSources) ?? fallbackOutput(params);
  const facts = output.facts.map((fact) => fact.text);
  const markdown = renderBrief({ selection, question, facts });
  const briefTokens = estimateTokens(markdown);

  return {
    id: briefId,
    branchId,
    selection,
    markdown,
    facts,
    excludedNote: output.excludedNote,
    availableTokens,
    briefTokens,
    prunedPct: prunedPct(availableTokens, briefTokens),
    sourceRefs: compilerSources.map(toSourceRef),
    factSourceIds: output.facts.map((fact) => [...fact.sourceIds]),
  };
}

function buildCompilerSources(params: CompileParams): ContextSource[] {
  const querySources: ContextSource[] = [
    {
      kind: 'selection',
      conversationId: params.branchId,
      sourceId: `selection:${params.branchId}`,
      content: params.selection,
    },
    ...(params.question.trim()
      ? [
          {
            kind: 'question' as const,
            conversationId: params.branchId,
            sourceId: `question:${params.branchId}`,
            content: params.question,
          },
        ]
      : []),
  ];

  return [...params.parentContext.sources.map((source) => ({ ...source })), ...querySources];
}

function toSourceRef(source: ContextSource): ContextSourceRef {
  return {
    kind: source.kind,
    conversationId: source.conversationId,
    sourceId: source.sourceId,
  };
}

async function runCompiler(sources: ContextSource[]): Promise<string> {
  const result = await complete({
    tier: INTERNAL_TIER,
    maxTokens: 600,
    messages: [
      {
        role: 'system',
        content:
          'You compile minimal context briefs. Extract ONLY the facts needed to answer the branch question. Resolve every referent so each fact stands alone. Each [source:kind:sourceId] marker is followed by a JSON string containing its source text. Respond with JSON only: {"facts":[{"text":string,"sourceIds":string[]}],"excludedNote":string}. Return at most 8 short facts. Every fact must cite at least one source ID, and every source ID must come exactly from a supplied marker. Never invent a source ID.',
      },
      {
        role: 'user',
        content: ['Sources:', sources.map(renderContextSource).join('\n\n')].join('\n'),
      },
    ],
  });

  return result.text;
}

function parseCompilerOutput(text: string, sources: ContextSource[]): CompilerOutput | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;

  try {
    const json = JSON.parse(text.slice(start, end + 1)) as {
      facts?: unknown;
      excludedNote?: unknown;
    };
    if (!Array.isArray(json.facts)) return undefined;

    const validSourceIds = new Set(sources.map((source) => source.sourceId));
    const facts = json.facts
      .flatMap((candidate): CompilerFact[] => {
        if (!isRecord(candidate) || typeof candidate.text !== 'string') return [];
        const text = candidate.text.trim();
        if (!text || !Array.isArray(candidate.sourceIds)) return [];
        const sourceIds = candidate.sourceIds.filter(
          (sourceId, index, all): sourceId is string =>
            typeof sourceId === 'string' &&
            validSourceIds.has(sourceId) &&
            all.indexOf(sourceId) === index,
        );
        return sourceIds.length ? [{ text, sourceIds }] : [];
      })
      .slice(0, MAX_FACTS);

    if (!facts.length) return undefined;
    return {
      facts,
      excludedNote:
        typeof json.excludedNote === 'string'
          ? json.excludedNote
          : 'Excluded: the rest of the parent conversation.',
    };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function fallbackOutput(params: CompileParams): CompilerOutput {
  console.warn('[compiler] unparseable output — using fallback facts');
  const terms = keywords(`${params.selection} ${params.question}`);
  const ranked = params.parentContext.sources
    .map((source, index) => ({
      source,
      index,
      score: overlap(source.content, terms),
      sentence: firstCompleteSentence(source.content),
    }))
    .filter((candidate) => candidate.score > 0 && candidate.sentence)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_FALLBACK_FACTS);

  if (ranked.length) {
    return {
      facts: ranked.map(({ source, sentence }) => ({
        text: sentence,
        sourceIds: [source.sourceId],
      })),
      excludedNote: 'Excluded: the rest of the parent conversation (compiler fallback).',
    };
  }

  return {
    facts: [
      {
        text: `Topic in focus: ${params.selection}.`,
        sourceIds: [`selection:${params.branchId}`],
      },
    ],
    excludedNote:
      'Excluded: no relevant parent source was found (degraded compiler fallback).',
  };
}

function keywords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9'@&+-]*/g) ?? [];
  return [...new Set(words.filter((word) => word.length > 1 && !STOPWORDS.has(word)))];
}

function overlap(content: string, terms: string[]): number {
  const contentTerms = new Set(keywords(content));
  return terms.reduce((score, term) => score + Number(contentTerms.has(term)), 0);
}

function firstCompleteSentence(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.match(/^.*?[.!?](?=\s|$)/)?.[0].trim() ?? `${normalized}.`;
}

function renderBrief(params: {
  selection: string;
  question: string;
  facts: string[];
}): string {
  const lines = [
    `# Branch brief — ${params.selection}`,
    '',
    '## Relevant facts',
    ...params.facts.map((fact) => `- ${fact}`),
    '',
    '## Question',
    params.question || params.selection,
  ];
  return lines.join('\n');
}
