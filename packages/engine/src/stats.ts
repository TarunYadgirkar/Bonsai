/**
 * Token statistics over the inference log: measured-vs-estimated provenance, whole-session
 * aggregation, and the cumulative savings curve. Pure functions over InferenceLog rows —
 * no I/O, no store coupling.
 */
import { MODELS } from './models';
import type { InferenceLog, InferencePurpose } from './types';

/** Where a number came from: provider-reported usage, or a chars/4-style heuristic. */
export type TokenBasis = 'measured' | 'estimated';

export interface TokenFigure {
  value: number;
  basis: TokenBasis;
}

export function measuredFigure(value: number): TokenFigure {
  return { value, basis: 'measured' };
}

export function estimatedFigure(value: number): TokenFigure {
  return { value, basis: 'estimated' };
}

/**
 * Sum figures, propagating basis: a total is measured only when every part was.
 * The empty sum is measured — zero of anything is exact.
 */
export function combineFigures(figures: readonly TokenFigure[]): TokenFigure {
  return {
    value: figures.reduce((sum, f) => sum + f.value, 0),
    basis: figures.every((f) => f.basis === 'measured') ? 'measured' : 'estimated',
  };
}

/**
 * InferenceLog plus the optional provenance flag lib/accounting.ts can attach
 * (true when token counts came from live provider usage, i.e. CompleteResult.mock === false).
 * Absent — mock rows, and rows written before the flag existed — reads as estimated.
 */
export type StatsLog = InferenceLog & { measured?: boolean };

interface GroupTotals {
  count: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface PurposeStats extends GroupTotals {
  purpose: InferencePurpose;
  /** This purpose's share of total session spend, 0-100 to one decimal. */
  costSharePct: number;
}

export interface ModelStats extends GroupTotals {
  model: string;
  /** Catalog label when the id is known; the raw id otherwise. */
  label: string;
  costSharePct: number;
}

export interface SessionSavings {
  /** The baseline is always a modeled counterfactual — never measured billing. */
  baselineInputTokens: number;
  baselineCostUsd: number;
  tokensSaved: number;
  costSavedUsd: number;
  tokensSavedPct: number;
  costSavedPct: number;
}

export interface SessionStats {
  inferenceCount: number;
  /** 'measured' only when every log row carries provider-reported usage. */
  basis: TokenBasis;
  totals: {
    inputTokens: TokenFigure;
    outputTokens: TokenFigure;
    costUsd: TokenFigure;
  };
  savings: SessionSavings;
  /** Purposes actually present this session, in chat/compile/classify/merge order. */
  byPurpose: PurposeStats[];
  /** Models actually used, biggest spend first. */
  byModel: ModelStats[];
  /** Share of chat answers the escalation ladder retried upward, 0-100 to one decimal. */
  escalationRatePct: number;
  /** Share of chat answers where a manual pick bypassed the router, 0-100 to one decimal. */
  overriddenRatePct: number;
}

const PURPOSE_ORDER: InferencePurpose[] = ['chat', 'compile', 'classify', 'merge'];

const roundUsd = (usd: number): number => Math.round(usd * 1e6) / 1e6;

/** part-of-whole as 0-100 to one decimal; 0 when the whole is empty. */
const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

const pctSaved = (baseline: number, actual: number): number =>
  baseline > 0 ? Math.round(((baseline - actual) / baseline) * 1000) / 10 : 0;

const rowBasis = (log: StatsLog): TokenBasis => (log.measured ? 'measured' : 'estimated');

function totalsOf(rows: readonly StatsLog[]): GroupTotals {
  return rows.reduce<GroupTotals>(
    (acc, r) => ({
      count: acc.count + 1,
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      costUsd: acc.costUsd + r.estCostUsd,
    }),
    { count: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );
}

/** modelSpec() falls back to the catalog's first entry, which would mislabel unknown ids. */
const modelLabel = (id: string): string => MODELS.find((m) => m.id === id)?.label ?? id;

function purposeBreakdown(logs: readonly StatsLog[], totalCostUsd: number): PurposeStats[] {
  return PURPOSE_ORDER.flatMap((purpose) => {
    const rows = logs.filter((l) => l.purpose === purpose);
    if (rows.length === 0) return [];
    const t = totalsOf(rows);
    return [
      { purpose, ...t, costUsd: roundUsd(t.costUsd), costSharePct: pct(t.costUsd, totalCostUsd) },
    ];
  });
}

function modelBreakdown(logs: readonly StatsLog[], totalCostUsd: number): ModelStats[] {
  const ids = [...new Set(logs.map((l) => l.model))];
  return ids
    .map((model) => {
      const t = totalsOf(logs.filter((l) => l.model === model));
      return {
        model,
        label: modelLabel(model),
        ...t,
        costUsd: roundUsd(t.costUsd),
        costSharePct: pct(t.costUsd, totalCostUsd),
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd || a.model.localeCompare(b.model));
}

export function sessionStats(logs: readonly StatsLog[]): SessionStats {
  const inputTokens = combineFigures(
    logs.map((l) => ({ value: l.inputTokens, basis: rowBasis(l) })),
  );
  const outputTokens = combineFigures(
    logs.map((l) => ({ value: l.outputTokens, basis: rowBasis(l) })),
  );
  const rawCost = combineFigures(logs.map((l) => ({ value: l.estCostUsd, basis: rowBasis(l) })));
  const costUsd = { ...rawCost, value: roundUsd(rawCost.value) };

  const baselineInputTokens = logs.reduce((sum, l) => sum + l.baselineInputTokens, 0);
  const baselineCostUsd = roundUsd(logs.reduce((sum, l) => sum + l.baselineCostUsd, 0));

  const chats = logs.filter((l) => l.purpose === 'chat');

  return {
    inferenceCount: logs.length,
    basis: costUsd.basis,
    totals: { inputTokens, outputTokens, costUsd },
    savings: {
      baselineInputTokens,
      baselineCostUsd,
      tokensSaved: baselineInputTokens - inputTokens.value,
      costSavedUsd: roundUsd(baselineCostUsd - costUsd.value),
      tokensSavedPct: pctSaved(baselineInputTokens, inputTokens.value),
      costSavedPct: pctSaved(baselineCostUsd, costUsd.value),
    },
    byPurpose: purposeBreakdown(logs, rawCost.value),
    byModel: modelBreakdown(logs, rawCost.value),
    escalationRatePct: pct(chats.filter((l) => l.escalated).length, chats.length),
    overriddenRatePct: pct(chats.filter((l) => l.overridden).length, chats.length),
  };
}

export interface SavingsPoint {
  /** 1-based inference number — "after i inferences". */
  i: number;
  /** Cumulative routed spend through inference i, USD. */
  actual: number;
  /** Cumulative modeled full-history strong-model spend through inference i, USD. */
  baseline: number;
}

/** Cumulative actual-vs-baseline cost per inference, in log order — sparkline-ready. */
export function savingsCurve(logs: readonly StatsLog[]): SavingsPoint[] {
  let actual = 0;
  let baseline = 0;
  return logs.map((log, idx) => {
    actual += log.estCostUsd;
    baseline += log.baselineCostUsd;
    return { i: idx + 1, actual: roundUsd(actual), baseline: roundUsd(baseline) };
  });
}
