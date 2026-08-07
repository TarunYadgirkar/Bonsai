import { listLogs, loadStore } from '@/lib/store';
import type { EconomicsBaseline, EconomicsResponse, EconomicsTotals } from '@/lib/types';

export const dynamic = 'force-dynamic';

function pctSaved(baseline: number, actual: number): number {
  if (baseline <= 0) return 0;
  return Math.round(((baseline - actual) / baseline) * 1000) / 10;
}

export async function GET() {
  await loadStore();
  const logs = listLogs();

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

  const response: EconomicsResponse = { logs, totals, baseline };
  return Response.json(response);
}
