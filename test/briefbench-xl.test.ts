import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { caseResult, gradeLevel, regressions, summarize, unsupportedNumbers, type XlCase } from '../evals/xl/grade';

const cases = readFileSync(join(__dirname, '../evals/xl/eval.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as XlCase);

const brief = (markdown: string) => ({ markdown, prunedPct: 60, briefTokens: 40, availableTokens: 100 });

describe('BriefBench-XL data', () => {
  it('holds 300 cases, 60 per family, with depth 2 as two-fork chains', () => {
    expect(cases).toHaveLength(300);
    const byFamily = Object.groupBy(cases, (c) => c.family);
    expect(Object.keys(byFamily).sort()).toEqual(['ambiguous', 'depth1_referent', 'depth2', 'long_trunk', 'salience']);
    for (const rows of Object.values(byFamily)) expect(rows).toHaveLength(60);
    expect(byFamily.depth2!.every((c) => c.forks.length === 2)).toBe(true);
  });
});

describe('BriefBench-XL grading', () => {
  const testCase = cases.find((c) => c.family === 'depth1_referent')!;
  const fork = testCase.forks[0];
  const source = testCase.messages.map((m) => m.content).join('\n');

  it('passes a brief that keeps every required entity', () => {
    const level = gradeLevel(brief(fork.must_contain.join('. ')), fork, testCase, source);
    expect(caseResult(testCase, [level]).pass).toBe(true);
  });

  it('fails an empty brief', () => {
    const level = gradeLevel(brief(''), fork, testCase, source);
    expect(caseResult(testCase, [level])).toMatchObject({ pass: false, referentsOk: false });
  });

  it('flags an entity from another conversation as a hallucination', () => {
    const level = gradeLevel(brief(`${fork.must_contain.join('. ')}. ${testCase.must_not_contain[0]}`), fork, testCase, source);
    expect(level.clean).toBe(false);
  });

  it('treats a number with different separators as supported', () => {
    expect(unsupportedNumbers('stipend 55000 and 12', 'a $55,000 stipend')).toEqual(['12']);
  });

  it('reports a drop against the baseline', () => {
    const level = gradeLevel(brief(fork.must_contain.join('. ')), fork, testCase, source);
    const good = summarize([caseResult(testCase, [level])]);
    const bad = summarize([caseResult(testCase, [gradeLevel(brief(''), fork, testCase, source)])]);
    expect(regressions(good, good)).toEqual([]);
    expect(regressions(bad, good).join('\n')).toMatch(/pass 0 < baseline 1/);
  });
});
