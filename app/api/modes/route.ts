import { EFFORTS, MODELS, TIER_DEFAULTS, TIER_LABEL } from '@/lib/models';

/**
 * The mode picker's catalog: three models × four effort levels, plus what Auto would pick per
 * tier. Additive route (M5) so the UI never hardcodes a model name — lib/models.ts stays the
 * single source of truth for names and rates.
 */
export async function GET() {
  return Response.json({
    models: MODELS,
    efforts: EFFORTS,
    tierDefaults: TIER_DEFAULTS,
    tierLabels: TIER_LABEL,
    /** Rates are published-list, applied to locally generated text — modeled spend, not billed. */
    pricingNote: 'Cost is modeled at published per-token rates.',
  });
}
