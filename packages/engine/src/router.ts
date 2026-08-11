/**
 * Routes intelligence, not just models.
 *
 * Order of optimization per PRODUCT.md: context -> effort -> model -> retry. The compiler has
 * already minimized context by the time we get here, so this decides effort + model — and when
 * an answer fails, the ladder pulls the CONTEXT lever (widen the brief with parent turns)
 * before it pulls the model lever. A manual pick is never silently upgraded: the user's choice
 * is their own labelled example, and overriding it would destroy the signal.
 */
import { complete as defaultComplete, type CompleteFn } from './llm';
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
  /** Per-request mode picker. 'manual' names a model and an effort; 'auto' (or absent) classifies. */
  mode?: ModeSelection;
  /** Branch-level persisted pin. Loses to a per-request manual mode, beats pinnedTier. */
  pinnedMode?: ModeSelection | null;
}

export interface RouterDeps {
  complete: CompleteFn;
}

const DEFAULT_DEPS: RouterDeps = { complete: defaultComplete };

export async function route(
  params: RouteParams,
  deps: RouterDeps = DEFAULT_DEPS,
): Promise<RoutingDecision> {
  const { question, contextTokens, pinnedTier } = params;

  // An explicit pick is the user's own labelled example — skip the classifier entirely.
  const manual =
    params.mode?.mode === 'manual' && params.mode.model
      ? params.mode
      : params.pinnedMode?.mode === 'manual' && params.pinnedMode.model
        ? params.pinnedMode
        : null;
  if (manual?.model) {
    const model = modelSpec(manual.model);
    const effort = manual.effort ?? TIER_DEFAULTS[model.tier].effort;
    return decision({
      tier: model.tier,
      model: model.id,
      effort,
      complexity: model.tier === 'deep' ? 3 : model.tier === 'thoughtful' ? 2 : 1,
      contextTokens,
      reason: `You picked ${model.label} at ${effortSpec(effort).label} effort; classification skipped.`,
      overridden: true,
    });
  }

  if (pinnedTier) {
    return decision({
      tier: pinnedTier,
      complexity: pinnedTier === 'deep' ? 3 : pinnedTier === 'thoughtful' ? 2 : 1,
      contextTokens,
      reason: `Branch pinned to ${TIER_LABEL[pinnedTier]} by you; classification skipped.`,
      overridden: true,
    });
  }

  const { complexity, covered, why } = await classify(params, deps);
  const tier = TIER_BY_COMPLEXITY[complexity];

  return decision({
    tier,
    complexity,
    contextTokens,
    reason: `${why} Complexity ${complexity}/3 against a ${contextTokens}-token compiled brief.`,
    overridden: false,
    coveredByBrief: covered,
  });
}

/**
 * One cheap call. Cost discipline is the product — the classifier never runs on a big model.
 * It reads the brief's facts, so "does the brief cover this question" is judged before any
 * spend on an answer that was doomed to punt.
 */
async function classify(
  params: RouteParams,
  deps: RouterDeps,
): Promise<{ complexity: Complexity; covered: boolean; why: string }> {
  const factsBlock = params.brief?.facts.length
    ? `\nBrief facts:\n${params.brief.facts.map((f) => `- ${f}`).join('\n')}`
    : '';
  const result = await deps.complete({
    tier: INTERNAL_TIER,
    purpose: 'classify',
    maxTokens: 120,
    messages: [
      {
        role: 'system',
        content:
          'You rate how much intelligence a question deserves, and whether the provided brief facts cover it. complexity: 1 = a single fact lookup answerable from the given context. 2 = synthesis or explanation over a few facts. 3 = multi-constraint reasoning, ranking, or weighing trade-offs. covered: whether the brief facts contain what the question needs (true when no facts are provided). Respond with JSON only: {"complexity": 1|2|3, "covered": true|false, "reason": "<8 words>"}.',
      },
      {
        role: 'user',
        content: `Context size: ${params.contextTokens} tokens.${factsBlock}\nQuestion: ${params.question}`,
      },
    ],
  });

  const parsed = parseClassifier(result.text);
  if (parsed) return parsed;

  console.warn('[router] unparseable classifier output — defaulting to thoughtful');
  return { complexity: 2, covered: true, why: 'Classifier unclear; defaulted to the middle tier.' };
}

function parseClassifier(
  text: string,
): { complexity: Complexity; covered: boolean; why: string } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const json = JSON.parse(text.slice(start, end + 1)) as {
      complexity?: number;
      covered?: boolean;
      reason?: string;
    };
    const value = Number(json.complexity);
    if (value !== 1 && value !== 2 && value !== 3) return null;
    return {
      complexity: value as Complexity,
      covered: typeof json.covered === 'boolean' ? json.covered : true,
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
  coveredByBrief?: boolean;
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
    ...(params.coveredByBrief === undefined ? {} : { coveredByBrief: params.coveredByBrief }),
  };
}

/**
 * Punts signal a context problem first, a capability problem second. The short-answer check
 * only counts against synthesis questions — a complexity-1 lookup answered in three words is
 * a success, not a failure.
 */
const PUNT =
  /\b(i (don'?t|do not) (have|know)|not enough (context|information)|cannot determine|unclear from|(brief|context)[^.]{0,60}does not cover)/i;

export function answerFailsSanityCheck(answer: string, complexity: Complexity = 2): boolean {
  if (PUNT.test(answer)) return true;
  return complexity >= 2 && answer.trim().length < 40;
}

export interface EscalationParams {
  routing: RoutingDecision;
  systemPrompt: string;
  userPrompt: string;
  /**
   * The context lever: returns a replacement user prompt with parent turns pulled in beside
   * the brief, or null when there is nothing to widen with. Called at most once.
   */
  widen?: () => { userPrompt: string; addedTokens: number } | null;
}

export interface EscalationResult {
  text: string;
  routing: RoutingDecision;
  inputTokens: number;
  outputTokens: number;
}

/**
 * The ladder, in the product's stated order: context first, model second, never past the
 * ceiling, and never over a user's explicit pick.
 *
 *   1. If the classifier already judged the brief insufficient, widen before the first call.
 *   2. Answer. Passes the sanity check → done.
 *   3. Punt with an unused widen available → widen, retry on the SAME model.
 *   4. Still punting → upgrade the model (next tier, then the ceiling) — unless the routing
 *      was a manual pick or pin, which the ladder must not override.
 */
export async function completeWithEscalation(
  params: EscalationParams,
  deps: RouterDeps = DEFAULT_DEPS,
): Promise<EscalationResult> {
  let routing = params.routing;
  let userPrompt = params.userPrompt;
  let widened = false;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;

  const tryWiden = (): boolean => {
    if (widened || !params.widen) return false;
    const wider = params.widen();
    if (!wider) return false;
    userPrompt = wider.userPrompt;
    widened = true;
    routing = {
      ...routing,
      widened: true,
      contextTokens: routing.contextTokens + wider.addedTokens,
      reason: `${routing.reason} Widened with parent turns: the brief did not cover the question.`,
    };
    return true;
  };

  if (routing.coveredByBrief === false) tryWiden();

  const call = async (model: string, tier: Tier, effort: Effort | undefined) => {
    const result = await deps.complete({
      tier,
      model,
      effort,
      purpose: 'chat',
      messages: [
        { role: 'system' as const, content: params.systemPrompt },
        { role: 'user' as const, content: userPrompt },
      ],
    });
    totalInput += result.inputTokens;
    totalOutput += result.outputTokens;
    totalCost += result.estCostUsd;
    return result;
  };

  const finish = (text: string, servedBy?: string): EscalationResult => ({
    text,
    routing: { ...routing, estCostUsd: totalCost, ...(servedBy ? { servedBy } : {}) },
    inputTokens: totalInput,
    outputTokens: totalOutput,
  });

  let result = await call(routing.model, routing.tier, routing.effort);
  if (!answerFailsSanityCheck(result.text, routing.complexity)) {
    return finish(result.text, result.servedBy);
  }

  // Context lever: same model, wider prompt.
  if (tryWiden()) {
    result = await call(routing.model, routing.tier, routing.effort);
    if (!answerFailsSanityCheck(result.text, routing.complexity)) {
      return finish(result.text, result.servedBy);
    }
  }

  // Model lever — never over an explicit user pick, never past the ceiling.
  if (routing.overridden) return finish(result.text, result.servedBy);

  const upgraded = NEXT_TIER[routing.tier];
  const atCeiling = routing.model === CEILING_MODEL;
  if (!upgraded && atCeiling) return finish(result.text, result.servedBy);

  const upgradedTier = upgraded ?? routing.tier;
  const upgradedModel = upgraded ? TIER_DEFAULTS[upgraded].model : CEILING_MODEL;
  const upgradedEffort = upgraded ? TIER_DEFAULTS[upgraded].effort : (routing.effort ?? 'high');
  const before = routing;
  routing = {
    ...routing,
    tier: upgradedTier,
    model: upgradedModel,
    effort: upgradedEffort,
    modelLabel: modelSpec(upgradedModel).label,
    label: routingLabel(upgradedModel, upgradedEffort),
    effortNote: effortNote(upgradedModel, upgradedEffort),
    escalated: true,
    reason: `${before.reason} Escalated to ${routingLabel(upgradedModel, upgradedEffort)}: the ${
      before.label ?? before.modelLabel
    } answer failed the sanity check.`,
  };
  const second = await call(upgradedModel, upgradedTier, upgradedEffort);
  return finish(second.text, second.servedBy);
}
