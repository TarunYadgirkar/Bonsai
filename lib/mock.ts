/**
 * M0 stubs. Replaced by lib/compiler.ts (M1), lib/router.ts (M2) and lib/llm.ts (M1) —
 * the API routes keep the same shapes, so Person A's UI does not change when they land.
 */
import {
  INTERNAL_TIER,
  MODEL_TIERS,
  TIER_DEFAULTS,
  TIER_EFFORT,
  costForModel,
  estimateCostUsd,
} from './models';
import { availableTokensFor, nextId } from './store';
import { estimateTokens, prunedPct } from './tokens';
import type {
  Complexity,
  ContextBrief,
  Effort,
  InferenceLog,
  InferencePurpose,
  Message,
  RoutingDecision,
  Tier,
} from './types';

/** Rough stand-in for the classifier: long, multi-clause, comparative questions read as deep. */
function mockComplexity(question: string): Complexity {
  const q = question.toLowerCase();
  const heavy = /rank|compare|trade-?off|opportunity cost|explain why|given (my|everything)|top \d/.test(q);
  const wordCount = q.trim().split(/\s+/).length;
  if (heavy || wordCount > 24) return 3;
  if (wordCount > 12) return 2;
  return 1;
}

const TIER_BY_COMPLEXITY: Record<Complexity, Tier> = {
  1: 'quick',
  2: 'thoughtful',
  3: 'deep',
};

export function mockRoute(
  question: string,
  contextTokens: number,
  pinnedTier?: Tier | null,
): RoutingDecision {
  const complexity = mockComplexity(question);
  const tier = pinnedTier ?? TIER_BY_COMPLEXITY[complexity];
  const outputTokens = tier === 'deep' ? 700 : tier === 'thoughtful' ? 350 : 160;
  return {
    tier,
    model: MODEL_TIERS[tier],
    effortNote: TIER_EFFORT[tier],
    contextTokens,
    estCostUsd: estimateCostUsd(tier, contextTokens, outputTokens),
    reason: pinnedTier
      ? `Branch pinned to ${pinnedTier}; classification skipped.`
      : `Complexity ${complexity}/3 on a ${contextTokens}-token compiled brief.`,
    complexity,
    escalated: false,
    overridden: Boolean(pinnedTier),
  };
}

export function mockBrief(
  branchId: string,
  parentId: string,
  selection: string,
  question: string,
): ContextBrief {
  const available = availableTokensFor(parentId);
  const facts = [
    `Topic in focus: ${selection}.`,
    'User: Tarun, incoming Berkeley freshman, applied math, CS-focused, running a startup with a cofounder.',
    'Goal: join at most two clubs; builder-first and startup-adjacent over resume-padding.',
    'Hard constraint: 8-10 hrs/week total across all clubs.',
    'Free Ventures is priority one — applications close Sept 11, info session Sept 3.',
    'Berkeley Consulting already ruled out (case-interview recruiting).',
  ];
  const markdown = [
    `# Branch brief — ${selection}`,
    '',
    ...facts.map((f) => `- ${f}`),
    '',
    `Question: ${question || selection}`,
  ].join('\n');
  const briefTokens = estimateTokens(markdown);
  return {
    id: nextId('brief'),
    branchId,
    selection,
    markdown,
    facts,
    excludedNote:
      'Excluded: the full club-by-club comparison, workload analysis, decision tree, and interview prep from the parent thread. Ask to pull them in if needed.',
    availableTokens: available,
    briefTokens,
    prunedPct: prunedPct(available, briefTokens),
    memoryIds: [],
  };
}

const CANNED: Record<Tier, string> = {
  quick:
    'Free Ventures applications close **September 11**, with an info session on September 3. That is eight days between the session and the deadline — draft the application before September 3 rather than after.',
  thoughtful:
    'Short answer: it depends on whether your 8-10 hr/week cap is real. If it is, the only second club that fits is Blueprint at 6-8 hrs with low variance. If you would revise the cap to 13-14 for something worth it, ML@B is the option with the higher ceiling.',
  deep:
    'Ranked, with the opportunity cost of each:\n\n1. **Free Ventures** — the only option whose hours go into your own company. Cost: ~3-4 hrs/week of pure overhead, and a September application window that collides with technical-org recruiting.\n2. **ML@B** — strongest technical peer group and the highest ceiling. Cost: 12-14 hrs/week in your first semester once the education track is counted, with a three-week spike that lands on November midterms and, if you are in Free Ventures, on demo day prep.\n3. **Blueprint** — fits the cap and has the strongest community. Cost: almost no technical stretch; you would likely be the strongest engineer on your team, which is comfortable and not very educational.\n\nCodebase is dominated in both branches and should be cut to reclaim the application slot.',
};

export function mockCompletion(tier: Tier, question: string): string {
  return CANNED[tier] ?? `(${tier}) ${question}`;
}

export function mockMessage(tier: Tier, question: string, routing: RoutingDecision): Message {
  return {
    id: nextId('msg'),
    role: 'assistant',
    content: mockCompletion(tier, question),
    routing,
    createdAt: new Date().toISOString(),
  };
}

export function mockInsight(selection: string): string {
  return `Free Ventures apps close Sept 11; user plans to apply with the startup. (${selection})`;
}

export function buildLog(params: {
  branchId: string;
  purpose: InferencePurpose;
  tier: Tier;
  inputTokens: number;
  outputTokens: number;
  baselineInputTokens: number;
  escalated?: boolean;
  overridden?: boolean;
  /** From the routing decision when there is one, so a manual pick is what the panel shows. */
  model?: string;
  effort?: Effort;
}): InferenceLog {
  const { branchId, purpose, tier, inputTokens, outputTokens, baselineInputTokens } = params;
  const model = params.model ?? MODEL_TIERS[tier];
  return {
    id: nextId('log'),
    ts: new Date().toISOString(),
    branchId,
    purpose,
    tier,
    model,
    effort: params.effort ?? TIER_DEFAULTS[tier].effort,
    inputTokens,
    outputTokens,
    estCostUsd: costForModel(model, inputTokens, outputTokens),
    escalated: params.escalated ?? false,
    overridden: params.overridden ?? false,
    baselineInputTokens,
    baselineCostUsd: estimateCostUsd('deep', baselineInputTokens, outputTokens),
  };
}

export { INTERNAL_TIER };
