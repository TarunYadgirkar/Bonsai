/**
 * BriefBench-XL: 300 generated cases across BriefBench's five families, compiled by the real
 * engine. Run: `npm run eval:xl` (mock with no keys, live with one).
 *
 *   --write-baseline   record this run as evals/xl/baseline.<provider>.json
 *   --json             print the summary as JSON
 *
 * With a baseline recorded for the current provider, any drop in pass or referent rate, or rise
 * in hallucination, overall or in any family, exits nonzero. That is the CI gate.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assemblePath,
  compileBrief,
  estimateTokens,
  providerName,
  type Conversation,
  type UserProfile,
} from 'bonsai-engine';
import { caseResult, gradeLevel, regressions, summarize, type LevelVerdict, type XlCase, type XlSummary } from './grade';

const here = dirname(fileURLToPath(import.meta.url));

function loadCases(): XlCase[] {
  return readFileSync(join(here, 'eval.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as XlCase);
}

/** "Name — context. Goals: a; b." → the shape the engine renders back into that same line. */
function toProfile(line: string | null): UserProfile | undefined {
  if (!line) return undefined;
  const [name, rest = ''] = line.split(' — ', 2);
  const [context, goals = ''] = rest.split(' Goals: ', 2);
  return {
    name,
    context: context.trim(),
    goals: goals.replace(/\.$/, '').split('; ').filter(Boolean),
  };
}

function conversation(
  id: string,
  messages: XlCase['messages'],
  extra: Partial<Conversation> = {},
): Conversation {
  return {
    id,
    title: id,
    parentId: null,
    messages: messages.map((m, i) => ({ id: `${id}_m${i}`, role: m.role, content: m.content })),
    insights: [],
    pinnedTier: null,
    archived: false,
    ...extra,
  };
}

/** Each level is compiled by the engine and fed forward, so depth 2 must compose to pass. */
async function runCase(testCase: XlCase): Promise<LevelVerdict[]> {
  const profile = toProfile(testCase.profile);
  let parent = conversation(`${testCase.id}_root`, testCase.messages, profile ? { profile } : {});
  const byIdMap = new Map([[parent.id, parent]]);
  const byId = (id: string) => byIdMap.get(id);
  const levels: LevelVerdict[] = [];

  for (const [depth, fork] of testCase.forks.entries()) {
    const path = assemblePath({ parent, byId });
    const branchId = `${testCase.id}_b${depth + 1}`;
    const { brief } = await compileBrief({
      briefId: `${branchId}_brief`,
      branchId,
      pathMarkdown: path.markdown,
      profile: profile,
      selection: fork.selection,
      question: fork.question,
      availableTokens: estimateTokens(path.markdown),
      anchorFact: path.anchorFact,
      inheritedFacts: path.inheritedFacts,
    });
    levels.push(gradeLevel(brief, fork, testCase, `${path.markdown}\n${fork.selection}\n${fork.question}`));
    parent = conversation(branchId, fork.branch_messages, { parentId: parent.id, brief });
    byIdMap.set(parent.id, parent);
  }
  return levels;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function report(summary: XlSummary): void {
  console.log(`BriefBench-XL · provider: ${providerName()} · ${summary.n} cases\n`);
  console.log('family            n   pass    referents  hallucination  prune');
  const row = (label: string, r: XlSummary | XlSummary['byFamily'][string]) =>
    console.log(
      `${label.padEnd(16)} ${String(r.n).padStart(3)}  ${pct(r.passRate).padStart(6)}  ${pct(r.referentRate).padStart(9)}  ${pct(r.hallucinationRate).padStart(13)}  ${pct(r.pruneRate).padStart(5)}`,
    );
  for (const [family, r] of Object.entries(summary.byFamily)) row(family, r);
  row('overall', summary);
  console.log(`\ncompression vs full history: ${pct(summary.compression)}`);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const cases = loadCases();
  const results = [];
  for (const testCase of cases) results.push(caseResult(testCase, await runCase(testCase)));
  const summary = summarize(results);

  if (args.has('--json')) console.log(JSON.stringify(summary, null, 2));
  else report(summary);

  const baselinePath = join(here, `baseline.${providerName()}.json`);
  if (args.has('--write-baseline')) {
    writeFileSync(baselinePath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`\nbaseline written: evals/xl/baseline.${providerName()}.json`);
    return;
  }
  if (!existsSync(baselinePath)) {
    console.log(`\nno baseline for ${providerName()}; record one with --write-baseline`);
    return;
  }
  const failed = regressions(summary, JSON.parse(readFileSync(baselinePath, 'utf8')) as XlSummary);
  if (failed.length) {
    console.error(`\nregressed against evals/xl/baseline.${providerName()}.json:\n  ${failed.join('\n  ')}`);
    const misses = results.filter((r) => !r.pass).slice(0, 10);
    for (const r of misses) console.error(`  FAIL ${r.id}: ${r.detail ?? 'prune floor'}`);
    process.exit(1);
  }
  console.log(`\nno regression against evals/xl/baseline.${providerName()}.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
