'use client';

import { useEffect, useState } from 'react';
import type { EconomicsResponse, InferenceLog } from '@/lib/types';
import { EFFORT_LABEL } from './ModeBadge';
import { formatUsd } from './tokens';

const PURPOSE_LABEL: Record<InferenceLog['purpose'], string> = {
  chat: 'Answer',
  compile: 'Compile brief',
  classify: 'Classify',
  merge: 'Distill insight',
};

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

const clock = (ts: string) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

/** Hero number: one percentage, with the two raw figures it came from underneath. */
function SavingsCard({
  label,
  savedPct,
  actual,
  baseline,
  actualNote,
  baselineNote,
  baselineCaption,
}: {
  label: string;
  savedPct: number;
  actual: string;
  baseline: string;
  actualNote: string;
  baselineNote: string;
  /** Names the struck-through figure a modeled counterfactual, never measured billing. */
  baselineCaption: string;
}) {
  return (
    <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 font-mono text-4xl leading-none tabular-nums text-emerald-300">
        {savedPct.toFixed(1)}%
      </div>
      <div className="mt-1 text-[11px] text-neutral-500">saved</div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-white/10 pt-3 text-[11px]">
        <dt className="text-neutral-500">{actualNote}</dt>
        <dd className="text-right font-mono tabular-nums text-white">{actual}</dd>
        <dt className="text-neutral-500">{baselineNote}</dt>
        <dd className="text-right font-mono tabular-nums text-neutral-400 line-through">
          {baseline}
        </dd>
      </dl>
      <p className="mt-2 text-[10px] leading-snug text-neutral-600">{baselineCaption}</p>
    </div>
  );
}

/**
 * Every number here comes from GET /api/economics — the same InferenceLog rows the engine
 * wrote during this session. Actuals are what ran; baselines are modeled counterfactuals.
 */
export function EconomicsPanel({
  branchTitles,
  onClose,
}: {
  branchTitles: Record<string, string>;
  onClose: () => void;
}) {
  const [data, setData] = useState<EconomicsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/economics', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`GET /api/economics → ${res.status}`);
        return res.json() as Promise<EconomicsResponse>;
      })
      .then(
        (body) => !cancelled && setData(body),
        (err) => !cancelled && setError(describe(err)),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Session economics"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-neutral-950 shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-white/10 px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Session economics</h2>
            <p className="text-[11px] text-neutral-500">
              Live from this session&apos;s inference log — every call Bonsai made.
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <p className="rounded-lg border border-white/10 bg-white/[0.03] p-4 font-mono text-xs text-neutral-400">
              {error}
            </p>
          )}

          {!data && !error && <p className="text-sm text-neutral-500">Loading numbers…</p>}

          {data && (
            <>
              <div className="flex flex-col gap-3 sm:flex-row">
                <SavingsCard
                  label="Input tokens"
                  savedPct={data.baseline.tokensSavedPct}
                  actual={data.totals.inputTokens.toLocaleString()}
                  actualNote="Bonsai (compiled)"
                  baseline={data.baseline.inputTokens.toLocaleString()}
                  baselineNote="Full-history baseline"
                  baselineCaption="vs sending the full parent history every turn (modeled, not measured)"
                />
                <SavingsCard
                  label="Spend"
                  savedPct={data.baseline.costSavedPct}
                  actual={formatUsd(data.totals.costUsd)}
                  actualNote="Routed spend"
                  baseline={formatUsd(data.baseline.costUsd)}
                  baselineNote="Strong model always"
                  baselineCaption="vs full history on the strongest model (modeled at list rates)"
                />
                <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                    This session
                  </div>
                  <div className="mt-1 font-mono text-4xl leading-none tabular-nums text-white">
                    {data.totals.inferenceCount}
                  </div>
                  <div className="mt-1 text-[11px] text-neutral-500">inferences</div>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-white/10 pt-3 text-[11px]">
                    <dt className="text-neutral-500">Tokens in</dt>
                    <dd className="text-right font-mono tabular-nums text-white">
                      {data.totals.inputTokens.toLocaleString()}
                    </dd>
                    <dt className="text-neutral-500">Tokens out</dt>
                    <dd className="text-right font-mono tabular-nums text-white">
                      {data.totals.outputTokens.toLocaleString()}
                    </dd>
                  </dl>
                </div>
              </div>

              {data.logs.length === 0 ? (
                <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-xs text-neutral-500">
                  No inferences logged yet. Branch off the conversation and ask something —
                  every call lands here.
                </p>
              ) : (
                <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full min-w-[720px] border-collapse text-left text-[11px]">
                    <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wide text-neutral-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Time</th>
                        <th className="px-3 py-2 font-medium">Branch</th>
                        <th className="px-3 py-2 font-medium">Purpose</th>
                        <th className="px-3 py-2 font-medium">Effort</th>
                        <th className="px-3 py-2 font-medium">Model</th>
                        <th className="px-3 py-2 text-right font-medium">Context in</th>
                        <th className="px-3 py-2 text-right font-medium">Out</th>
                        <th className="px-3 py-2 text-right font-medium">Cost</th>
                        <th className="px-3 py-2 text-right font-medium">Baseline (modeled)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.logs.map((log) => (
                        <tr key={log.id} className="border-t border-white/[0.06]">
                          <td className="px-3 py-2 tabular-nums text-neutral-500">
                            {clock(log.ts)}
                          </td>
                          <td className="max-w-[160px] truncate px-3 py-2 text-neutral-300">
                            {branchTitles[log.branchId] ?? log.branchId}
                          </td>
                          <td className="px-3 py-2 text-neutral-400">
                            {PURPOSE_LABEL[log.purpose] ?? log.purpose}
                            {log.escalated && (
                              <span className="ml-1.5 text-[10px] text-amber-300/80">
                                escalated
                              </span>
                            )}
                            {log.overridden && (
                              <span className="ml-1.5 text-[10px] text-neutral-500">pinned</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-neutral-300">
                            {log.effort ? EFFORT_LABEL[log.effort] : '—'}
                          </td>
                          <td className="max-w-[180px] truncate px-3 py-2 font-mono text-neutral-400">
                            {log.model}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-white">
                            {log.inputTokens.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-400">
                            {log.outputTokens.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-300">
                            {formatUsd(log.estCostUsd)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-500 line-through">
                            {formatUsd(log.baselineCostUsd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="mt-3 text-[11px] leading-snug text-neutral-500">
                Baseline is a modeled counterfactual, not measured billing: the same requests
                carrying the full parent history, answered on the strongest model every time,
                priced at published per-token list rates. That is what a flat chat log would
                have cost.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
