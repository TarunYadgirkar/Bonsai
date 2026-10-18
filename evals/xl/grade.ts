/**
 * BriefBench-XL assertions, ported from bonsai-distill's checks.py. Every check is string-level
 * entity presence, so it grades the mock, a live compiler and a distilled student identically.
 */

export interface XlFork {
  selection: string;
  question: string;
  /** Entities that MUST appear (case-insensitive) in this level's brief. */
  must_contain: string[];
  /** The branch transcript after this fork, which the next level forks from. */
  branch_messages: { role: 'user' | 'assistant'; content: string }[];
}

export interface XlCase {
  id: string;
  family: string;
  profile: string | null;
  messages: { role: 'user' | 'assistant'; content: string }[];
  forks: XlFork[];
  /** Pool entities absent from this conversation: in a brief they are hallucinated by construction. */
  must_not_contain: string[];
  min_pruned_pct: number | null;
}

export interface LevelVerdict {
  referentsOk: boolean;
  missing: string[];
  hallucinated: string[];
  fabricatedNumbers: string[];
  clean: boolean;
  pruneOk: boolean;
  briefTokens: number;
  baselineTokens: number;
}

export function missingEntities(haystack: string, needles: string[]): string[] {
  const hay = haystack.toLowerCase();
  return needles.filter((n) => !hay.includes(n.toLowerCase()));
}

export function presentEntities(haystack: string, needles: string[]): string[] {
  const hay = haystack.toLowerCase();
  return needles.filter((n) => hay.includes(n.toLowerCase()));
}

const NUMBER = /\d[\d,.]*/g;
const canon = (n: string) => n.replace(/[,.]/g, '');

/** Numbers in the brief that appear nowhere in the source. "55,000" in the source supports "55000". */
export function unsupportedNumbers(briefMarkdown: string, sourceText: string): string[] {
  const supported = new Set((sourceText.match(NUMBER) ?? []).map(canon));
  return (briefMarkdown.match(NUMBER) ?? []).filter((n) => !supported.has(canon(n)));
}

/** One fork level. `sourceText` is everything the compiler was shown, the ground set for numbers. */
export function gradeLevel(
  brief: { markdown: string; prunedPct: number; briefTokens: number; availableTokens: number },
  fork: XlFork,
  testCase: XlCase,
  sourceText: string,
): LevelVerdict {
  const missing = missingEntities(brief.markdown, fork.must_contain);
  const hallucinated = presentEntities(brief.markdown, testCase.must_not_contain);
  const fabricatedNumbers = unsupportedNumbers(brief.markdown, sourceText);
  return {
    referentsOk: missing.length === 0,
    missing,
    hallucinated,
    fabricatedNumbers,
    clean: hallucinated.length === 0 && fabricatedNumbers.length === 0,
    pruneOk: testCase.min_pruned_pct === null || brief.prunedPct >= testCase.min_pruned_pct,
    briefTokens: brief.briefTokens,
    baselineTokens: brief.availableTokens,
  };
}

export interface CaseResult {
  id: string;
  family: string;
  referentsOk: boolean;
  clean: boolean;
  pruneOk: boolean;
  pass: boolean;
  briefTokens: number;
  baselineTokens: number;
  /** First failing level's detail, for the report. */
  detail?: string;
}

/** A case passes when the FINAL level kept its referents and every level met its prune floor. */
export function caseResult(testCase: XlCase, levels: LevelVerdict[]): CaseResult {
  const final = levels[levels.length - 1];
  const pruneOk = levels.every((l) => l.pruneOk);
  const clean = levels.every((l) => l.clean);
  const dirty = levels.find((l) => !l.clean);
  return {
    id: testCase.id,
    family: testCase.family,
    referentsOk: final.referentsOk,
    clean,
    pruneOk,
    pass: final.referentsOk && pruneOk,
    briefTokens: final.briefTokens,
    baselineTokens: final.baselineTokens,
    ...(final.missing.length
      ? { detail: `missing ${final.missing.join(', ')}` }
      : dirty
        ? { detail: `hallucinated ${[...dirty.hallucinated, ...dirty.fabricatedNumbers].join(', ')}` }
        : {}),
  };
}

export interface Rates {
  n: number;
  passRate: number;
  referentRate: number;
  hallucinationRate: number;
  pruneRate: number;
}

export interface XlSummary extends Rates {
  compression: number;
  byFamily: Record<string, Rates>;
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

function rates(rows: CaseResult[]): Rates {
  const share = (pick: (r: CaseResult) => boolean) => round4(rows.filter(pick).length / rows.length);
  return {
    n: rows.length,
    passRate: share((r) => r.pass),
    referentRate: share((r) => r.referentsOk),
    hallucinationRate: share((r) => !r.clean),
    pruneRate: share((r) => r.pruneOk),
  };
}

export function summarize(results: CaseResult[]): XlSummary {
  const briefSum = results.reduce((s, r) => s + r.briefTokens, 0);
  const baseSum = results.reduce((s, r) => s + r.baselineTokens, 0);
  const families = [...new Set(results.map((r) => r.family))].sort();
  return {
    ...rates(results),
    compression: baseSum ? round4(1 - briefSum / baseSum) : 0,
    byFamily: Object.fromEntries(families.map((f) => [f, rates(results.filter((r) => r.family === f))])),
  };
}

/** Regressions against a recorded baseline: a lower pass/referent rate or a higher hallucination rate. */
export function regressions(current: XlSummary, baseline: XlSummary): string[] {
  const out: string[] = [];
  const compare = (label: string, now: Rates | undefined, then: Rates) => {
    if (!now) return out.push(`${label}: family missing from this run`);
    if (now.passRate < then.passRate) out.push(`${label}: pass ${now.passRate} < baseline ${then.passRate}`);
    if (now.referentRate < then.referentRate) out.push(`${label}: referents ${now.referentRate} < baseline ${then.referentRate}`);
    if (now.hallucinationRate > then.hallucinationRate) {
      out.push(`${label}: hallucination ${now.hallucinationRate} > baseline ${then.hallucinationRate}`);
    }
  };
  compare('overall', current, baseline);
  for (const [family, then] of Object.entries(baseline.byFamily)) compare(family, current.byFamily[family], then);
  return out;
}
