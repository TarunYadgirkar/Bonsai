/**
 * Context compiler. Turns a parent conversation into the smallest self-contained brief that
 * answers a branch's question.
 *
 * The hard requirement is referent resolution: "when do apps close?" is unanswerable without
 * knowing that "apps" means Free Ventures applications. If the brief leaves a dangling
 * pronoun, a small model cannot answer it and the cheap route becomes unsafe.
 */
import { complete } from './llm';
import { INTERNAL_TIER } from './models';
import { estimateTokens, prunedPct } from './tokens';
import type { ContextBrief, Message, UserProfile } from './types';

const MAX_FACTS = 8;

export interface CompileParams {
  briefId: string;
  branchId: string;
  parentMessages: Message[];
  profile?: UserProfile;
  selection: string;
  question: string;
  availableTokens: number;
}

interface CompilerOutput {
  facts: string[];
  excludedNote: string;
}

export async function compileBrief(params: CompileParams): Promise<ContextBrief> {
  const { briefId, branchId, selection, question, availableTokens } = params;

  const parsed = await runCompiler(params);
  const facts = parsed.facts.slice(0, MAX_FACTS);
  const markdown = renderBrief({ selection, question, facts, profile: params.profile });
  const briefTokens = estimateTokens(markdown);

  return {
    id: briefId,
    branchId,
    selection,
    markdown,
    facts,
    excludedNote: parsed.excludedNote,
    availableTokens,
    briefTokens,
    prunedPct: prunedPct(availableTokens, briefTokens),
  };
}

async function runCompiler(params: CompileParams): Promise<CompilerOutput> {
  const transcript = params.parentMessages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n\n');

  const profileLine = params.profile
    ? `${params.profile.name} — ${params.profile.context} Goals: ${params.profile.goals.join('; ')}.`
    : 'unknown';

  const result = await complete({
    tier: INTERNAL_TIER,
    maxTokens: 600,
    messages: [
      {
        role: 'system',
        content:
          'You compile minimal context briefs. Given a parent conversation and a branch topic, extract ONLY the facts needed to answer the branch question. Resolve every referent so each fact stands alone without the parent — never write "apps", "it", "that club" where a name belongs. Respond with JSON only: {"facts": string[], "excludedNote": string}. facts: at most 8 short self-contained sentences. excludedNote: one sentence naming what you deliberately left out.',
      },
      {
        role: 'user',
        content: [
          `User profile: ${profileLine}`,
          `Branch topic (highlighted text): ${params.selection}`,
          `Branch question: ${params.question || params.selection}`,
          '',
          'Parent conversation:',
          transcript,
        ].join('\n'),
      },
    ],
  });

  return parseCompilerOutput(result.text, params.selection);
}

function parseCompilerOutput(text: string, selection: string): CompilerOutput {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const json = JSON.parse(text.slice(start, end + 1)) as Partial<CompilerOutput>;
      if (Array.isArray(json.facts) && json.facts.length) {
        return {
          facts: json.facts.filter((f): f is string => typeof f === 'string'),
          excludedNote:
            typeof json.excludedNote === 'string'
              ? json.excludedNote
              : 'Excluded: the rest of the parent conversation.',
        };
      }
    } catch {
      // fall through to the heuristic below
    }
  }

  console.warn('[compiler] unparseable output — using fallback facts');
  return {
    facts: [`Topic in focus: ${selection}.`],
    excludedNote: 'Excluded: the rest of the parent conversation (compiler fallback).',
  };
}

function renderBrief(params: {
  selection: string;
  question: string;
  facts: string[];
  profile?: UserProfile;
}): string {
  const lines = [`# Branch brief — ${params.selection}`, ''];

  if (params.profile) {
    lines.push(`**User:** ${params.profile.name} — ${params.profile.context}`, '');
  }

  lines.push('## Relevant facts', ...params.facts.map((f) => `- ${f}`));

  lines.push('', `## Question`, params.question || params.selection);
  return lines.join('\n');
}
