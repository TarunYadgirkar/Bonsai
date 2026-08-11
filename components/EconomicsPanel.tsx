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

/** Bonsai's share of the modeled baseline, clamped to the bar. */
const share = (actual: number, baseline: number) =>
  baseline > 0 ? Math.max(0, Math.min(100, (actual / baseline) * 100)) : 0;

/**
 * A season bar: the full track carries the horticultural spend scale (young growth → summer →
 * ember), which is the one gradient the design permits because it encodes real cost. Bonsai's
 * actual usage sits in the young end; the costly ember season it never paid for is ghosted back
 * toward paper. The ink hairline marks where Bonsai actually landed against the full-history
 * baseline.
 */
function SeasonBar({
  label,
  savedPct,
  sharePct,
  actual,
  baseline,
  actualNote,
  baselineNote,
  baselineCaption,
}: {
  label: string;
  savedPct: number;
  sharePct: number;
  actual: string;
  baseline: string;
  actualNote: string;
  baselineNote: string;
  /** Names the struck-through figure a modeled counterfactual, never measured billing. */
  baselineCaption: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">{label}</span>
        <span className="text-[0.8125rem] text-moss">
          <span className="tnum">{savedPct.toFixed(1)}%</span> pruned
        </span>
      </div>

      <div
        className="relative mt-2.5 h-2.5 w-full overflow-hidden rounded-full ring-1 ring-inset ring-rule"
        style={{
          background:
            'linear-gradient(90deg, var(--season-young) 0%, var(--season-summer) 55%, var(--season-ember) 100%)',
        }}
      >
        {/* the ember season Bonsai pruned away — ghosted back toward paper, still faintly there */}
        <div
          className="absolute inset-y-0 right-0"
          style={{
            left: `${sharePct}%`,
            background: 'color-mix(in oklab, var(--paper-raised) 80%, transparent)',
          }}
        />
        {/* where Bonsai actually landed against the full-history baseline */}
        <div
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-ink"
          style={{ left: `${sharePct}%` }}
        />
      </div>

      <div className="mt-2 flex items-baseline justify-between text-xs">
        <span className="text-ink-soft">
          {actualNote} <span className="tnum text-ink">{actual}</span>
        </span>
        <span className="text-bark">
          {baselineNote} <span className="tnum line-through">{baseline}</span>
        </span>
      </div>

      <p className="mt-1.5 text-[0.6875rem] leading-snug text-bark">{baselineCaption}</p>
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

  // Actuals provenance: 'measured' only when every log row carried live provider usage.
  const basisWord = data?.stats.basis === 'measured' ? 'measured' : 'modeled';

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Session economics"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-rule bg-paper-raised"
        style={{ boxShadow: '0 18px 60px -24px color-mix(in oklab, var(--ink) 34%, transparent)' }}
      >
        <header className="flex items-start gap-4 border-b border-rule px-8 py-6">
          <div>
            <div className="eyebrow">spend</div>
            <h2 className="mt-1 font-display text-[1.375rem] leading-tight text-ink">
              Session economics
            </h2>
            <p className="mt-1 text-[0.8125rem] text-ink-soft">
              Live from this session&apos;s inference log — every call Bonsai made.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md border border-rule px-3 py-1.5 text-xs text-ink-soft transition-colors hover:bg-paper-sunk hover:text-ink"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {error && (
            <p className="border border-rule bg-paper-sunk p-4 text-xs text-ember">
              <span className="tnum">{error}</span>
            </p>
          )}

          {!data && !error && <p className="text-sm text-ink-soft">Loading numbers…</p>}

          {data && (
            <>
              <section className="grid gap-x-10 gap-y-7 sm:grid-cols-2">
                <SeasonBar
                  label="input tokens"
                  savedPct={data.baseline.tokensSavedPct}
                  sharePct={share(data.totals.inputTokens, data.baseline.inputTokens)}
                  actual={data.totals.inputTokens.toLocaleString()}
                  actualNote="Bonsai (compiled)"
                  baseline={data.baseline.inputTokens.toLocaleString()}
                  baselineNote="full history"
                  baselineCaption={`vs sending the full parent history every turn (baseline modeled; actuals ${basisWord})`}
                />
                <SeasonBar
                  label="spend"
                  savedPct={data.baseline.costSavedPct}
                  sharePct={share(data.totals.costUsd, data.baseline.costUsd)}
                  actual={formatUsd(data.totals.costUsd)}
                  actualNote="routed spend"
                  baseline={formatUsd(data.baseline.costUsd)}
                  baselineNote="strong model always"
                  baselineCaption={`vs full history on the strongest model (modeled at list rates; actuals ${basisWord})`}
                />
              </section>

              <section className="mt-7 flex flex-wrap items-baseline gap-x-10 gap-y-3 border-t border-rule pt-5">
                <div className="flex items-baseline gap-2">
                  <span className="tnum text-4xl leading-none text-ink">
                    {data.totals.inferenceCount}
                  </span>
                  <span className="text-xs text-bark">inferences this session</span>
                </div>
                <div className="text-xs text-ink-soft">
                  <span className="tnum text-ink">
                    {data.totals.inputTokens.toLocaleString()}
                  </span>{' '}
                  tokens in
                </div>
                <div className="text-xs text-ink-soft">
                  <span className="tnum text-ink">
                    {data.totals.outputTokens.toLocaleString()}
                  </span>{' '}
                  tokens out
                </div>
                <div className="text-xs text-ink-soft">
                  <span className="tnum text-ink">
                    {data.stats.escalationRatePct.toFixed(1)}%
                  </span>{' '}
                  escalated
                </div>
                <div className="text-xs text-ink-soft">
                  <span className="tnum text-ink">
                    {data.stats.overriddenRatePct.toFixed(1)}%
                  </span>{' '}
                  pinned
                </div>
                <div className="text-xs text-ink-soft">
                  counts <span className="text-ink">{basisWord}</span>
                </div>
              </section>

              {data.stats.byPurpose.length > 0 && (
                <section className="mt-7">
                  <div className="eyebrow mb-2.5">spend by purpose</div>
                  {data.stats.byPurpose.map((p) => (
                    <div
                      key={p.purpose}
                      className="flex items-baseline justify-between border-t border-rule py-2 text-xs"
                    >
                      <span className="text-ink-soft">{PURPOSE_LABEL[p.purpose] ?? p.purpose}</span>
                      <span className="flex items-baseline gap-6">
                        <span className="tnum text-bark">{p.count}×</span>
                        <span className="tnum text-moss">{formatUsd(p.costUsd)}</span>
                        <span className="tnum w-14 text-right text-ink">
                          {p.costSharePct.toFixed(1)}%
                        </span>
                      </span>
                    </div>
                  ))}
                </section>
              )}

              <section className="mt-7">
                <div className="eyebrow mb-2.5">per-inference log</div>
                {data.logs.length === 0 ? (
                  <p className="border-t border-rule pt-6 text-center text-xs text-ink-soft">
                    No inferences logged yet. Branch off the conversation and ask something —
                    every call lands here.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-rule-strong">
                          <th className="eyebrow px-3 py-2 text-left font-medium">time</th>
                          <th className="eyebrow px-3 py-2 text-left font-medium">branch</th>
                          <th className="eyebrow px-3 py-2 text-left font-medium">purpose</th>
                          <th className="eyebrow px-3 py-2 text-left font-medium">effort</th>
                          <th className="eyebrow px-3 py-2 text-left font-medium">model</th>
                          <th className="eyebrow px-3 py-2 text-right font-medium">context in</th>
                          <th className="eyebrow px-3 py-2 text-right font-medium">out</th>
                          <th className="eyebrow px-3 py-2 text-right font-medium">cost</th>
                          <th className="eyebrow px-3 py-2 text-right font-medium">
                            baseline (modeled)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.logs.map((log) => (
                          <tr key={log.id} className="border-t border-rule">
                            <td className="tnum px-3 py-2 text-bark">{clock(log.ts)}</td>
                            <td className="max-w-[160px] truncate px-3 py-2 text-ink-soft">
                              {branchTitles[log.branchId] ?? log.branchId}
                            </td>
                            <td className="px-3 py-2 text-ink-soft">
                              {PURPOSE_LABEL[log.purpose] ?? log.purpose}
                              {log.escalated && (
                                <span className="ml-1.5 text-[10px] text-ember">escalated</span>
                              )}
                              {log.overridden && (
                                <span className="ml-1.5 text-[10px] text-bark">pinned</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-ink-soft">
                              {log.effort ? EFFORT_LABEL[log.effort] : '—'}
                            </td>
                            <td className="tnum max-w-[180px] truncate px-3 py-2 text-bark">
                              {log.model}
                            </td>
                            <td className="tnum px-3 py-2 text-right text-ink">
                              {log.inputTokens.toLocaleString()}
                            </td>
                            <td className="tnum px-3 py-2 text-right text-ink-soft">
                              {log.outputTokens.toLocaleString()}
                            </td>
                            <td className="tnum px-3 py-2 text-right text-moss">
                              {formatUsd(log.estCostUsd)}
                            </td>
                            <td className="tnum px-3 py-2 text-right text-bark line-through">
                              {formatUsd(log.baselineCostUsd)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <p className="mt-4 max-w-2xl text-[0.6875rem] leading-relaxed text-bark">
                Baseline is a modeled counterfactual, not measured billing: the same requests
                carrying the full parent history, answered on the strongest model every time,
                priced at published per-token list rates. That is what a flat chat log would
                have cost.
                {basisWord === 'measured'
                  ? ' Actual counts are provider-reported usage.'
                  : ' Actual counts are modeled from character counts, not provider-reported usage.'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
