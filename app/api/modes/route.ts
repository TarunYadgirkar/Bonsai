import { EFFORTS, MODELS, TIER_DEFAULTS, TIER_LABEL } from '@bonsai/engine';

/**
 * The mode picker's catalog: three models × four effort levels, plus Auto. Additive route (M5) so
 * the UI never hardcodes a model name — lib/models.ts stays the single source of truth for names
 * and rates.
 *
 * Modes read as model + effort, the way Claude states it ("Opus 5 · High effort"). There are no
 * ⚡/🧠/🔬 tier names on the surface any more; `tier` survives inside the engine as the
 * classifier's 1-3 mapping and `autoPicks` is what Auto resolves each level to.
 */
export async function GET() {
  return Response.json({
    models: MODELS,
    efforts: EFFORTS,
    autoPicks: TIER_DEFAULTS,
    autoLabels: TIER_LABEL,
    modeNote: 'Auto classifies the question and picks both halves; Manual names them.',
    /** Rates are published-list, applied to locally generated text — modeled spend, not billed. */
    pricingNote: 'Cost is modeled at published per-token rates.',
  });
}
