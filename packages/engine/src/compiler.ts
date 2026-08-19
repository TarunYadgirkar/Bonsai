/**
 * Context compiler. Turns the assembled path above a fork into the smallest self-contained
 * brief that answers the branch's question.
 *
 * The hard requirement is referent resolution: "when do apps close?" is unanswerable without
 * knowing that "apps" means Free Ventures applications. If the brief leaves a dangling
 * pronoun, a small model cannot answer it and the cheap route becomes unsafe. Referents
 * resolved by an ancestor's brief stay resolved here because that brief is part of the
 * compile input (see context.ts — briefs compose recursively).
 */
import { complete as defaultComplete, type CompleteFn } from './llm';
import { logger } from './logger';
import { INTERNAL_TIER, MODEL_TIERS } from './models';
import { estimateTokens, prunedPct } from './tokens';
import type { ContextBrief, UserProfile } from './types';

const MAX_FACTS = 8;

/** Brief size target. Facts are dropped lowest-priority-first until the brief fits. */
const DEFAULT_BRIEF_BUDGET_TOKENS = 800;

export interface CompileParams {
  briefId: string;
  branchId: string;
  /** Assembled path context from assemblePath(): parent brief + insights + anchored transcript. */
  pathMarkdown: string;
  profile?: UserProfile;
  selection: string;
  question: string;
  availableTokens: number;
  anchorMessageId?: string;
  budgetTokens?: number;
  /** The inherited brief's top fact (AssembledPath.anchorFact) — pinned into the output so the
   *  chain's grounding entity survives composition even when this question never names it. */
  anchorFact?: string;
}

export interface EngineDeps {
  complete: CompleteFn;
}

/** What the compile call actually cost — logged, never fabricated. */
export interface CompileUsage {
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  model: string;
  mock: boolean;
  servedBy?: string;
}

export interface CompileResult {
  brief: ContextBrief;
  usage: CompileUsage;
}

interface CompilerOutput {
  facts: string[];
  excludedNote: string;
}

export async function compileBrief(
  params: CompileParams,
  deps: EngineDeps = { complete: defaultComplete },
): Promise<CompileResult> {
  const { briefId, branchId, selection, question, availableTokens } = params;
  const budget = params.budgetTokens ?? DEFAULT_BRIEF_BUDGET_TOKENS;

  const { parsed, usage } = await runCompiler(params, deps);

  // The compiler ranks facts by importance, so trimming from the tail is the cheapest cut.
  let facts = parsed.facts.slice(0, MAX_FACTS);
  // Referent closure across compositions: the chain's anchor fact leads the brief unless the
  // compiler already carried it through. One bounded line buys self-containment at any depth.
  const anchor = params.anchorFact?.trim();
  if (anchor && !anchorCarriedThrough(anchor, facts)) {
    facts = [anchor, ...facts].slice(0, MAX_FACTS);
  }
  let markdown = renderBrief({ selection, question, facts, profile: params.profile });
  while (facts.length > 1 && estimateTokens(markdown) > budget) {
    facts = facts.slice(0, -1);
    markdown = renderBrief({ selection, question, facts, profile: params.profile });
  }
  const briefTokens = estimateTokens(markdown);

  return {
    brief: {
      id: briefId,
      branchId,
      selection,
      markdown,
      facts,
      excludedNote: parsed.excludedNote,
      availableTokens,
      briefTokens,
      prunedPct: prunedPct(availableTokens, briefTokens),
      ...(params.anchorMessageId ? { anchorMessageId: params.anchorMessageId } : {}),
    },
    usage,
  };
}

async function runCompiler(
  params: CompileParams,
  deps: EngineDeps,
): Promise<{ parsed: CompilerOutput; usage: CompileUsage }> {
  const profileLine = params.profile
    ? `${params.profile.name} — ${params.profile.context} Goals: ${params.profile.goals.join('; ')}.`
    : 'unknown';

  const result = await deps.complete({
    tier: INTERNAL_TIER,
    purpose: 'compile',
    maxTokens: 600,
    messages: [
      {
        role: 'system',
        content:
          'You compile minimal context briefs. Given the context above a conversation fork and a branch topic, extract ONLY the facts needed to answer the branch question, ordered most load-bearing first: state the ONE fact the question most depends on first, then the rest in falling order of importance. Prefer facts a smaller model could not infer without them — the names, numbers, dates, and constraints that exist only in this conversation — over anything general knowledge supplies. Resolve every referent so each fact stands alone without the parent — never write "apps", "it", "that club" where a name belongs. Facts under "Inherited context" or "Learned from branches" headings are pre-distilled: carry the relevant ones through rather than re-deriving them. Respond with JSON only: {"facts": string[], "excludedNote": string}. facts: at most 8 short self-contained sentences. excludedNote: one sentence naming what you deliberately left out.',
      },
      {
        role: 'user',
        content: [
          `User profile: ${profileLine}`,
          `Branch topic (highlighted text): ${params.selection}`,
          `Branch question: ${params.question || params.selection}`,
          '',
          'Parent conversation:',
          params.pathMarkdown,
        ].join('\n'),
      },
    ],
  });

  return {
    parsed: parseCompilerOutput(result.text, params.selection),
    usage: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estCostUsd: result.estCostUsd,
      model: result.model ?? MODEL_TIERS[INTERNAL_TIER],
      mock: result.mock,
      ...(result.servedBy ? { servedBy: result.servedBy } : {}),
    },
  };
}

/**
 * Has the compiler already carried the anchor through in its TOP fact, possibly rephrased? True
 * when every entity-bearing token of the anchor (capitalized words, numbers) appears in facts[0]
 * — "Free Ventures closes September 11" carries "Free Ventures applications close September 11."
 * even though it doesn't match verbatim. Position 0 matters, not mere presence: the next
 * composition's anchor IS facts[0], so entities scattered anywhere else would satisfy this brief
 * yet break the chain one level down. Anchors with no entity tokens compare verbatim.
 */
export function anchorCarriedThrough(anchor: string, facts: string[]): boolean {
  const top = facts[0] ?? '';
  const entityTokens = anchor.match(/\b(?:[A-Z][\w'-]*|\d[\d,.]*)\b/g) ?? [];
  if (!entityTokens.length) return top.trim() === anchor;
  return entityTokens.every((t) => top.includes(t));
}

function parseCompilerOutput(text: string, selection: string): CompilerOutput {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const json = JSON.parse(text.slice(start, end + 1)) as Partial<CompilerOutput>;
      // Filter to strings FIRST, then gate on the result: a facts array of non-strings passes a
      // raw length check but filters to empty, yielding a factless brief that skips the fallback.
      const facts = Array.isArray(json.facts)
        ? json.facts.filter((f): f is string => typeof f === 'string')
        : [];
      if (facts.length) {
        return {
          facts,
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

  logger.warn('[compiler] unparseable output — using fallback facts');
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

/* ---------- merge grounding ---------- */

const GROUNDING_STOPWORDS = new Set(
  'The This That These Those There Answer Branch Insight Yes No None'.split(' '),
);

/**
 * Faithfulness gate for the one-insight merge contract: an insight that asserts numbers or
 * named entities the branch never mentioned is a hallucination about to be written into the
 * parent's context permanently. Every number in the insight must appear in the transcript
 * (digits compared, $/,/% ignored); at most one capitalized term may be novel (distillers
 * legitimately introduce a category word, but two unseen names is invention).
 */
export function insightGroundedIn(
  insight: string,
  transcript: string,
): { grounded: boolean; missing: string[] } {
  const hay = transcript.toLowerCase();
  const hayDigits = transcript.replace(/[^0-9.]/g, ' ');
  const missing: string[] = [];

  for (const raw of insight.match(/\$?\d[\d,]*(?:\.\d+)?%?/g) ?? []) {
    const digits = raw.replace(/[^0-9.]/g, '');
    if (digits && !hayDigits.includes(digits)) missing.push(raw);
  }

  const capitals = [...new Set(insight.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [])].filter(
    (w) => !GROUNDING_STOPWORDS.has(w),
  );
  const novelCapitals = capitals.filter((w) => !hay.includes(w.toLowerCase()));

  const numberMissing = missing.length > 0;
  missing.push(...novelCapitals);
  return { grounded: !numberMissing && novelCapitals.length <= 1, missing };
}
