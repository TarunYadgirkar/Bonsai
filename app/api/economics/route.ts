import { savingsCurve, sessionStats } from '@bonsai/engine';
import { apiRoute } from '@/lib/api';
import { resolveSession } from '@/lib/session';
import { loadWorkingSet } from '@/lib/store';
import type { EconomicsBaseline, EconomicsResponse, EconomicsTotals } from '@/lib/types';

export const dynamic = 'force-dynamic';

function pctSaved(baseline: number, actual: number): number {
  if (baseline <= 0) return 0;
  return Math.round(((baseline - actual) / baseline) * 1000) / 10;
}

export const GET = apiRoute(null, async (_body, request) => {
  const session = resolveSession(request);
  const ws = await loadWorkingSet(session.id, { withLogs: true });
  const logs = ws.logs;

  const totals: EconomicsTotals = logs.reduce<EconomicsTotals>(
    (acc, l) => ({
      inferenceCount: acc.inferenceCount + 1,
      inputTokens: acc.inputTokens + l.inputTokens,
      outputTokens: acc.outputTokens + l.outputTokens,
      costUsd: acc.costUsd + l.estCostUsd,
    }),
    { inferenceCount: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );
  totals.costUsd = Math.round(totals.costUsd * 1e6) / 1e6;

  const baselineInput = logs.reduce((sum, l) => sum + l.baselineInputTokens, 0);
  const baselineCost = logs.reduce((sum, l) => sum + l.baselineCostUsd, 0);

  const baseline: EconomicsBaseline = {
    inputTokens: baselineInput,
    costUsd: Math.round(baselineCost * 1e6) / 1e6,
    tokensSavedPct: pctSaved(baselineInput, totals.inputTokens),
    costSavedPct: pctSaved(baselineCost, totals.costUsd),
  };

  const response: EconomicsResponse = {
    logs,
    totals,
    baseline,
    stats: sessionStats(logs),
    savingsCurve: savingsCurve(logs),
  };
  // Deliberately no Set-Cookie: this fires in parallel with GET /api/state on first visit, and
  // two racing cookie mints would let the economics session win — every later chat would then
  // 404 against a root the state response never described. /api/state is the only GET minter.
  return Response.json(response);
});
