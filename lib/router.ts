/**
 * Routes intelligence, not just models.
 *
 * Order of optimization per PRODUCT.md: context -> effort -> model -> retry. The compiler has
 * already minimized context by the time we get here, so this decides effort + model, and
 * escalates only when the cheap answer fails a sanity check.
 */
import { complete } from './llm';
import { INTERNAL_TIER, MODEL_TIERS, TIER_EFFORT, estimateCostUsd } from './models';
import type { Complexity, ContextBrief, RoutingDecision, Tier } from './types';

const TIER_BY_COMPLEXITY: Record<Complexity, Tier> = {
  1: 'quick',
  2: 'thoughtful',
  3: 'deep',
};

const NEXT_TIER: Record<Tier, Tier | null> = {
  quick: 'thoughtful',
  thoughtful: 'deep',
  deep: null,
};

export interface RouteParams {
  question: string;
  brief?: ContextBrief;
  contextTokens: number;
  pinnedTier?: Tier | null;
}

export async function route(params: RouteParams): Promise<RoutingDecision> {
  const { question, contextTokens, pinnedTier } = params;

  // A pinned branch is the user's own labelled example — skip the classifier entirely.
  if (pinnedTier) {
    return decision({
      tier: pinnedTier,
      complexity: TIER_BY_COMPLEXITY[3] === pinnedTier ? 3 : 2,
      contextTokens,
      reason: `Branch pinned to ${pinnedTier} by you; classification skipped.`,
      overridden: true,
    });
  }

  const { complexity, why } = await classify(question, contextTokens);
  const tier = TIER_BY_COMPLEXITY[complexity];

  return decision({
    tier,
    complexity,
    contextTokens,
    reason: `${why} Complexity ${complexity}/3 against a ${contextTokens}-token compiled brief.`,
    overridden: false,
  });
}

/** One cheap call. Cost discipline is the product — the classifier never runs on a big model. */
async function classify(
  question: string,
  contextTokens: number,
): Promise<{ complexity: Complexity; why: string }> {
  const result = await complete({
    tier: INTERNAL_TIER,
    maxTokens: 120,
    messages: [
      {
        role: 'system',
        content:
          'You rate how much intelligence a question deserves. 1 = a single fact lookup answerable from the given context. 2 = synthesis or explanation over a few facts. 3 = multi-constraint reasoning, ranking, or weighing trade-offs. Respond with JSON only: {"complexity": 1|2|3, "reason": "<8 words>"}.',
      },
      {
        role: 'user',
        content: `Context size: ${contextTokens} tokens.\nQuestion: ${question}`,
      },
    ],
  });

  const parsed = parseClassifier(result.text);
  if (parsed) return parsed;

  console.warn('[router] unparseable classifier output — defaulting to thoughtful');
  return { complexity: 2, why: 'Classifier unclear; defaulted to the middle tier.' };
}

function parseClassifier(text: string): { complexity: Complexity; why: string } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const json = JSON.parse(text.slice(start, end + 1)) as { complexity?: number; reason?: string };
    const value = Number(json.complexity);
    if (value !== 1 && value !== 2 && value !== 3) return null;
    return {
      complexity: value as Complexity,
      why: typeof json.reason === 'string' ? `${json.reason}.` : 'Classified by the router.',
    };
  } catch {
    return null;
  }
}

function decision(params: {
  tier: Tier;
  complexity: Complexity;
  contextTokens: number;
  reason: string;
  overridden: boolean;
  escalated?: boolean;
}): RoutingDecision {
  const outputTokens = params.tier === 'deep' ? 700 : params.tier === 'thoughtful' ? 350 : 160;
  return {
    tier: params.tier,
    model: MODEL_TIERS[params.tier],
    effortNote: TIER_EFFORT[params.tier],
    contextTokens: params.contextTokens,
    estCostUsd: estimateCostUsd(params.tier, params.contextTokens, outputTokens),
    reason: params.reason,
    complexity: params.complexity,
    escalated: params.escalated ?? false,
    overridden: params.overridden,
  };
}

/**
 * Start cheap, escalate on failure. Answers that punt ("I don't have enough context") are the
 * signal that the brief was too small — which is a context problem the next tier can absorb.
 */
const PUNT = /\b(i (don'?t|do not) (have|know)|not enough (context|information)|cannot determine|unclear from)/i;

export function answerFailsSanityCheck(answer: string): boolean {
  return answer.trim().length < 40 || PUNT.test(answer);
}

export async function completeWithEscalation(params: {
  routing: RoutingDecision;
  systemPrompt: string;
  userPrompt: string;
}): Promise<{ text: string; routing: RoutingDecision; inputTokens: number; outputTokens: number }> {
  const messages = [
    { role: 'system' as const, content: params.systemPrompt },
    { role: 'user' as const, content: params.userPrompt },
  ];

  const first = await complete({ tier: params.routing.tier, messages });
  if (!answerFailsSanityCheck(first.text)) {
    return {
      text: first.text,
      routing: { ...params.routing, estCostUsd: first.estCostUsd },
      inputTokens: first.inputTokens,
      outputTokens: first.outputTokens,
    };
  }

  const upgraded = NEXT_TIER[params.routing.tier];
  if (!upgraded) {
    return {
      text: first.text,
      routing: { ...params.routing, estCostUsd: first.estCostUsd },
      inputTokens: first.inputTokens,
      outputTokens: first.outputTokens,
    };
  }

  const second = await complete({ tier: upgraded, messages });
  return {
    text: second.text,
    routing: {
      ...params.routing,
      tier: upgraded,
      model: MODEL_TIERS[upgraded],
      effortNote: TIER_EFFORT[upgraded],
      escalated: true,
      reason: `${params.routing.reason} Escalated to ${upgraded}: the ${params.routing.tier} answer failed the sanity check.`,
      estCostUsd: first.estCostUsd + second.estCostUsd,
    },
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
  };
}
