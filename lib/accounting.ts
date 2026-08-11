/**
 * Per-inference accounting: the live log row every route writes, with the strong-model
 * full-history counterfactual it is measured against.
 */
import {
  MODEL_TIERS,
  TIER_DEFAULTS,
  costForModel,
  estimateCostUsd,
  type Effort,
  type InferenceLog,
  type InferencePurpose,
  type Tier,
} from '@bonsai/engine';
import { newId } from './store';

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
  /**
   * The engine's own cost for this inference, summed across every escalation attempt and priced
   * at the model that actually served each (costForServedBy — a gpt/grok upstream bills at its own
   * rate, not Bonsai's tier catalog). Pass `routing.estCostUsd` here. Absent for the internal
   * compile/merge calls, which are a single Haiku pass and reprice correctly from the catalog.
   */
  estCostUsd?: number;
  /** True when token counts are live provider usage (CompleteResult.mock === false). Absent = estimated. */
  measured?: boolean;
}): InferenceLog & { measured?: boolean } {
  const { branchId, purpose, tier, inputTokens, outputTokens, baselineInputTokens } = params;
  const model = params.model ?? MODEL_TIERS[tier];
  return {
    id: newId('log'),
    ts: new Date().toISOString(),
    branchId,
    purpose,
    tier,
    model,
    effort: params.effort ?? TIER_DEFAULTS[tier].effort,
    inputTokens,
    outputTokens,
    estCostUsd: params.estCostUsd ?? costForModel(model, inputTokens, outputTokens),
    escalated: params.escalated ?? false,
    overridden: params.overridden ?? false,
    baselineInputTokens,
    baselineCostUsd: estimateCostUsd('deep', baselineInputTokens, outputTokens),
    measured: params.measured,
  };
}
