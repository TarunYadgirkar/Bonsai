import type { CompleteResult } from './llm';
import { CEILING_MODEL, INTERNAL_TIER, costForModel } from './models';
import { nextId } from './store';
import type { InferenceLog, InferencePurpose } from './types';

/** Build one log from one actual completion. Tokens and actual cost are never reconstructed. */
export function buildLog(params: {
  branchId: string;
  purpose: InferencePurpose;
  completion: CompleteResult;
  status: 'succeeded' | 'failed';
  baselineInputTokens?: number;
  escalated?: boolean;
  overridden?: boolean;
}): InferenceLog {
  const baselineInputTokens = params.baselineInputTokens ?? 0;
  return {
    id: nextId('log'),
    ts: new Date().toISOString(),
    branchId: params.branchId,
    purpose: params.purpose,
    tier: params.completion.tier,
    model: params.completion.model,
    effort: params.completion.effort,
    ...(params.completion.servedBy ? { servedBy: params.completion.servedBy } : {}),
    inputTokens: params.completion.inputTokens,
    outputTokens: params.completion.outputTokens,
    estCostUsd: params.completion.estCostUsd,
    status: params.status,
    escalated: params.escalated ?? false,
    overridden: params.overridden ?? false,
    baselineInputTokens,
    baselineCostUsd:
      baselineInputTokens === 0
        ? 0
        : costForModel(CEILING_MODEL, baselineInputTokens, params.completion.outputTokens),
  };
}

export { INTERNAL_TIER };
