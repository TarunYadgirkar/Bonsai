/**
 * Engine eval harness. Run: `npm run eval` (tsx evals/run.ts).
 *
 * With no provider keys this runs against the extractive mock — that gate proves the plumbing
 * (path assembly, coverage flags, routing thresholds) and runs in CI. With a live key the same
 * assertions grade real compiler output. Nonzero exit on any failure.
 */
import {
  assemblePath,
  compileBrief,
  complete,
  estimateTokens,
  profileFor,
  providerName,
  route,
  type Conversation,
  type ContextBrief,
} from '@bonsai/engine';
import { CASES, clubsRoot, conv, msg, type EvalCase } from './cases';

interface Verdict {
  name: string;
  pass: boolean;
  detail: string;
}

function contains(haystack: string, needles: string[]): string[] {
  const hay = haystack.toLowerCase();
  return needles.filter((n) => !hay.includes(n.toLowerCase()));
}

async function compileFor(
  parent: Conversation,
  ancestors: Conversation[],
  selection: string,
  question: string,
): Promise<ContextBrief> {
  const byIdMap = new Map([...ancestors, parent].map((c) => [c.id, c]));
  const byId = (id: string) => byIdMap.get(id);
  const path = assemblePath({ parent, byId });
  const { brief } = await compileBrief({
    briefId: `eval_brief_${parent.id}`,
    branchId: `eval_branch_${parent.id}`,
    pathMarkdown: path.markdown,
    profile: profileFor(parent, byId),
    selection,
    question,
    availableTokens: estimateTokens(path.markdown),
  });
  return brief;
}

async function runCase(c: EvalCase): Promise<Verdict> {
  if (c.kind === 'brief') {
    const brief = await compileFor(c.parent, c.ancestors ?? [], c.selection, c.question);
    const missing = contains(brief.markdown, c.mustContain);
    return {
      name: c.name,
      pass: missing.length === 0,
      detail: missing.length
        ? `brief missing: ${missing.join(', ')} — facts: ${brief.facts.join(' | ').slice(0, 200)}`
        : `${brief.facts.length} facts, ${brief.briefTokens} tokens`,
    };
  }

  if (c.kind === 'route') {
    const brief: ContextBrief = {
      id: 'eval_brief_r',
      branchId: 'eval_branch_r',
      selection: c.question.slice(0, 40),
      markdown: c.briefFacts.map((f) => `- ${f}`).join('\n'),
      facts: c.briefFacts,
      excludedNote: 'Excluded: everything else.',
      availableTokens: 5000,
      briefTokens: 120,
      prunedPct: 97.6,
    };
    const decision = await route({ question: c.question, brief, contextTokens: 120 });
    const tierOk = decision.tier === c.expectTier;
    const coveredOk = c.expectCovered === undefined || decision.coveredByBrief === c.expectCovered;
    return {
      name: c.name,
      pass: tierOk && coveredOk,
      detail: `tier ${decision.tier} (want ${c.expectTier}), covered ${decision.coveredByBrief}${
        c.expectCovered === undefined ? '' : ` (want ${c.expectCovered})`
      }`,
    };
  }

  // distill — mirrors the merge route's prompt contract.
  const result = await complete({
    tier: 'quick',
    purpose: 'merge',
    maxTokens: 120,
    messages: [
      {
        role: 'system',
        content:
          'Extract the single durable conclusion from this branch — the one thing the parent conversation should learn. One sentence, under 20 words, self-contained with referents resolved. No preamble, no quotes, just the sentence.',
      },
      {
        role: 'user',
        content: `Branch topic: ${c.branch.brief?.selection ?? c.branch.title}\n\n${c.branch.messages
          .map((m) => `${m.role}: ${m.content}`)
          .join('\n\n')}`,
      },
    ],
  });
  const line = result.text.trim().split('\n')[0] ?? '';
  const missing = contains(line, c.mustContain);
  const words = line.split(/\s+/).length;
  return {
    name: c.name,
    pass: missing.length === 0 && words <= c.maxWords,
    detail: `"${line.slice(0, 90)}" (${words} words)${missing.length ? ` missing: ${missing.join(', ')}` : ''}`,
  };
}

/**
 * The depth-2 proof, built live: fork the clubs root ("Free Ventures" resolved into the brief),
 * hold a sub-conversation that never names it, then fork AGAIN asking about "the deadline".
 * Only the inherited brief can resolve the referent — full-copy products get this free by
 * dragging the whole log; Bonsai must get it from brief composition.
 */
async function depthTwoCase(): Promise<Verdict> {
  const level1Brief = await compileFor(
    clubsRoot,
    [],
    'Free Ventures',
    'what is the application timeline?',
  );
  const branch1 = conv({
    id: 'eval_clubs_b1',
    title: 'Application timeline',
    parentId: clubsRoot.id,
    brief: { ...level1Brief, branchId: 'eval_clubs_b1' },
    messages: [
      msg('user', 'what is the application timeline?'),
      msg('assistant', 'Applications close September 11 with an info session on September 3.'),
    ],
  });
  const depth2 = await compileFor(branch1, [clubsRoot], 'the deadline', 'when is the deadline?');
  const missing = contains(depth2.markdown, ['Free Ventures']);
  return {
    name: 'depth-2 referent: grandparent entity survives via inherited brief',
    pass: missing.length === 0,
    detail: missing.length
      ? `depth-2 brief lost the referent — facts: ${depth2.facts.join(' | ').slice(0, 200)}`
      : `resolved through composed briefs (${depth2.facts.length} facts)`,
  };
}

async function main() {
  console.log(`bonsai evals — provider: ${providerName()}\n`);
  const verdicts: Verdict[] = [];
  for (const c of CASES) verdicts.push(await runCase(c));
  verdicts.push(await depthTwoCase());

  let failed = 0;
  for (const v of verdicts) {
    console.log(`${v.pass ? 'PASS' : 'FAIL'}  ${v.name}\n      ${v.detail}`);
    if (!v.pass) failed += 1;
  }
  console.log(`\n${verdicts.length - failed}/${verdicts.length} passed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
