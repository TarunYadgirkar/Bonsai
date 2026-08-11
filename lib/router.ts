/**
 * Routes intelligence, not just models.
 *
 * Order of optimization per PRODUCT.md: context -> effort -> model -> retry. The compiler has
 * already minimized context by the time we get here, so this decides effort + model, and
 * escalates only when the cheap answer fails a sanity check.
 */
import { complete } from './llm';
import type { CompletionEvent, CompleteResult } from './llm';
import {
  INTERNAL_TIER,
  CEILING_MODEL,
  MODEL_TIERS,
  TIER_DEFAULTS,
  TIER_LABEL,
  costForModel,
  effortNote,
  effortSpec,
  modelSpec,
  routingLabel,
} from './models';
import type {
  Complexity,
  ContextBrief,
  Effort,
  ModeSelection,
  RoutingDecision,
  Tier,
} from './types';

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
  /** Mode picker. 'manual' names a model and an effort; 'auto' (or absent) classifies. */
  mode?: ModeSelection;
}

export async function route(params: RouteParams): Promise<RoutingDecision> {
  return (await routeWithMetadata(params)).routing;
}

export interface RouteResult {
  routing: RoutingDecision;
  classifier?: CompletionEvent;
}

export async function routeWithMetadata(params: RouteParams): Promise<RouteResult> {
  const { question, contextTokens, pinnedTier, mode } = params;

  // An explicit pick is the user's own labelled example — skip the classifier entirely.
  if (mode?.mode === 'manual' && mode.model) {
    const model = modelSpec(mode.model);
    const effort = mode.effort ?? TIER_DEFAULTS[model.tier].effort;
    return {
      routing: decision({
        tier: model.tier,
        model: model.id,
        effort,
        complexity: model.tier === 'deep' ? 3 : model.tier === 'thoughtful' ? 2 : 1,
        contextTokens,
        reason: `You picked ${model.label} at ${effortSpec(effort).label} effort; classification skipped.`,
        overridden: true,
      }),
    };
  }

  if (pinnedTier) {
    return {
      routing: decision({
        tier: pinnedTier,
        complexity: TIER_BY_COMPLEXITY[3] === pinnedTier ? 3 : 2,
        contextTokens,
        reason: `Branch pinned to ${TIER_LABEL[pinnedTier]} by you; classification skipped.`,
        overridden: true,
      }),
    };
  }

  const { complexity, why, classifier } = await classify(question, contextTokens);
  const tier = TIER_BY_COMPLEXITY[complexity];

  return {
    routing: decision({
      tier,
      complexity,
      contextTokens,
      reason: `${why} Complexity ${complexity}/3 against a ${contextTokens}-token compiled brief.`,
      overridden: false,
    }),
    classifier,
  };
}

/** One cheap call. Cost discipline is the product — the classifier never runs on a big model. */
async function classify(
  question: string,
  contextTokens: number,
): Promise<{ complexity: Complexity; why: string; classifier: CompletionEvent }> {
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
  if (parsed) {
    return {
      ...parsed,
      classifier: { completion: result, status: 'succeeded' as const },
    };
  }

  console.warn('[router] unparseable classifier output — defaulting to thoughtful');
  return {
    complexity: 2,
    why: 'Classifier unclear; defaulted to the middle tier.',
    classifier: { completion: result, status: 'failed' },
  };
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
  model?: string;
  effort?: Effort;
}): RoutingDecision {
  const model = params.model ?? MODEL_TIERS[params.tier];
  const effort = params.effort ?? TIER_DEFAULTS[params.tier].effort;
  // Effort is priced as headroom to think: the ceiling it buys is what the estimate assumes.
  const outputTokens = Math.round(effortSpec(effort).maxTokens * 0.5);
  return {
    tier: params.tier,
    model,
    effort,
    modelLabel: modelSpec(model).label,
    label: routingLabel(model, effort),
    effortNote: effortNote(model, effort),
    contextTokens: params.contextTokens,
    estCostUsd: costForModel(model, params.contextTokens, outputTokens),
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

export interface EscalatedCompletionResult {
  text: string;
  routing: RoutingDecision;
  /** Compatibility fields describe the delivered attempt, never an aggregate of retries. */
  inputTokens: number;
  outputTokens: number;
  attempts: CompletionEvent[];
}

export class CompletionPipelineError extends Error {
  constructor(
    readonly cause: unknown,
    readonly attempts: CompletionEvent[],
  ) {
    super('completion pipeline failed', { cause });
    this.name = 'CompletionPipelineError';
  }
}

export async function completeWithEscalation(params: {
  routing: RoutingDecision;
  systemPrompt: string;
  userPrompt: string;
}): Promise<EscalatedCompletionResult> {
  const messages = [
    { role: 'system' as const, content: params.systemPrompt },
    { role: 'user' as const, content: params.userPrompt },
  ];

  const first = await complete({
    tier: params.routing.tier,
    model: params.routing.model,
    effort: params.routing.effort,
    messages,
  });
  if (!answerFailsSanityCheck(first.text)) {
    return {
      text: first.text,
      routing: { ...params.routing, estCostUsd: first.estCostUsd, servedBy: first.servedBy },
      inputTokens: first.inputTokens,
      outputTokens: first.outputTokens,
      attempts: [{ completion: first, status: 'succeeded' }],
    };
  }

  const upgraded = NEXT_TIER[params.routing.tier];

  /*
   * Above deep there is no higher tier, but there is a higher model: a deep answer that still
   * fails the check escalates onto the ceiling model rather than giving up. Only once — if the
   * ceiling itself punts, more spend is not the answer, and the brief is what's wrong.
   */
  const atCeiling = params.routing.model === CEILING_MODEL;
  if (!upgraded && atCeiling) {
    return {
      text: first.text,
      routing: { ...params.routing, estCostUsd: first.estCostUsd, servedBy: first.servedBy },
      inputTokens: first.inputTokens,
      outputTokens: first.outputTokens,
      attempts: [{ completion: first, status: 'succeeded' }],
    };
  }

  const upgradedTier = upgraded ?? params.routing.tier;
  const upgradedModel = upgraded ? TIER_DEFAULTS[upgraded].model : CEILING_MODEL;
  const upgradedEffort = upgraded ? TIER_DEFAULTS[upgraded].effort : params.routing.effort ?? 'high';
  let second: CompleteResult;
  try {
    second = await complete({
      tier: upgradedTier,
      model: upgradedModel,
      effort: upgradedEffort,
      messages,
    });
  } catch (error: unknown) {
    throw new CompletionPipelineError(error, [{ completion: first, status: 'failed' }]);
  }
  return {
    text: second.text,
    routing: {
      ...params.routing,
      tier: upgradedTier,
      model: upgradedModel,
      effort: upgradedEffort,
      modelLabel: modelSpec(upgradedModel).label,
      label: routingLabel(upgradedModel, upgradedEffort),
      effortNote: effortNote(upgradedModel, upgradedEffort),
      servedBy: second.servedBy,
      escalated: true,
      reason: `${params.routing.reason} Escalated to ${routingLabel(upgradedModel, upgradedEffort)}: the ${
        params.routing.label ?? params.routing.modelLabel
      } answer failed the sanity check.`,
      estCostUsd: second.estCostUsd,
    },
    inputTokens: second.inputTokens,
    outputTokens: second.outputTokens,
    attempts: [
      { completion: first, status: 'failed' },
      { completion: second, status: 'succeeded' },
    ],
  };
}
