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
  emptyProfile,
  estimateTokens,
  mergeProfiles,
  profileFor,
  providerName,
  recordFeedback,
  renderChatContext,
  route,
  type Conversation,
  type ContextBrief,
} from 'bonsai-engine';
import { CASES, clubsRoot, conv, fundingRoot, msg, type EvalCase } from './cases';

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
    anchorFact: path.anchorFact,
  });
  return brief;
}

async function runCase(c: EvalCase): Promise<Verdict> {
  if (c.kind === 'brief') {
    const brief = await compileFor(c.parent, c.ancestors ?? [], c.selection, c.question);
    const missing = contains(brief.markdown, c.mustContain);
    const pruneOk = c.minPrunedPct === undefined || brief.prunedPct >= c.minPrunedPct;
    return {
      name: c.name,
      pass: missing.length === 0 && pruneOk,
      detail: missing.length
        ? `brief missing: ${missing.join(', ')} — facts: ${brief.facts.join(' | ').slice(0, 200)}`
        : `${brief.facts.length} facts, ${brief.briefTokens} tokens, ${brief.prunedPct}% pruned${
            pruneOk ? '' : ` (want ≥${c.minPrunedPct}%)`
          }`,
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

/**
 * The salience proof, stricter than containment: the question's load-bearing fact lives in ONE
 * rare-term sentence ("stipend") while the noise sentences share more query words ("programs
 * offer"). A raw keyword-overlap count ranks the noise higher; salience must put the stipend
 * sentence at the top of the brief.
 */
async function salienceCase(): Promise<Verdict> {
  const brief = await compileFor(
    fundingRoot,
    [],
    'stipend amounts',
    'how large is the stipend the programs offer?',
  );
  const top = brief.facts[0] ?? '';
  const pass = /hertz/i.test(top) && top.includes('55,000');
  return {
    name: 'salience: the rare-term stipend sentence is the top-ranked fact',
    pass,
    detail: pass
      ? `top fact: "${top.slice(0, 90)}"`
      : `top fact "${top.slice(0, 90)}" — facts: ${brief.facts.join(' | ').slice(0, 200)}`,
  };
}

/**
 * The learning router, end to end: a lookup that classifies 'quick' every time. After the user
 * upgrades that quick pick three times, the profile pre-empts the classifier and starts the same
 * question at 'thoughtful' — same prompt, different route, because the history differs. This is
 * the "overriding teaches it" / "learns from what you kept" claim, executed rather than asserted.
 */
async function learningCase(): Promise<Verdict> {
  const question = 'When do Free Ventures applications close?';
  const brief: ContextBrief = {
    id: 'eval_brief_l',
    branchId: 'eval_branch_l',
    selection: 'Free Ventures',
    markdown: '- Free Ventures applications close September 11.',
    facts: ['Free Ventures applications close September 11.'],
    excludedNote: 'Excluded: everything else.',
    availableTokens: 5000,
    briefTokens: 60,
    prunedPct: 98.8,
  };

  const cold = await route({ question, brief, contextTokens: 60 });
  let profile = emptyProfile();
  for (let i = 0; i < 3; i += 1) {
    profile = recordFeedback(profile, {
      kind: 'override',
      classifiedTier: 'quick',
      chosenTier: 'deep',
    });
  }
  const warm = await route({ question, brief, contextTokens: 60, profile });

  const pass = cold.tier === 'quick' && warm.tier === 'thoughtful' && warm.learned === true;
  return {
    name: 'learning router: repeated upgrades shift the same question up a tier',
    pass,
    detail: `cold=${cold.tier} → warm=${warm.tier} (learned=${warm.learned})`,
  };
}

/**
 * The depth-2 proof extended one hop: root → timeline branch → deadline branch → a third fork
 * asking about "an extension on it". Three brief compositions in a row; the grandparent entity
 * must survive all of them, because no transcript below the root ever names it.
 */
async function depthThreeCase(): Promise<Verdict> {
  const level1 = await compileFor(clubsRoot, [], 'Free Ventures', 'what is the application timeline?');
  const branch1 = conv({
    id: 'eval_clubs_c1',
    title: 'Application timeline',
    parentId: clubsRoot.id,
    brief: { ...level1, branchId: 'eval_clubs_c1' },
    messages: [
      msg('user', 'what is the application timeline?'),
      msg('assistant', 'Applications close September 11 with an info session on September 3.'),
    ],
  });
  const level2 = await compileFor(branch1, [clubsRoot], 'the deadline', 'when is the deadline?');
  const branch2 = conv({
    id: 'eval_clubs_c2',
    title: 'The deadline',
    parentId: branch1.id,
    brief: { ...level2, branchId: 'eval_clubs_c2' },
    messages: [
      msg('user', 'when is the deadline?'),
      msg('assistant', 'It closes September 11; late submissions are not accepted.'),
    ],
  });
  const depth3 = await compileFor(
    branch2,
    [clubsRoot, branch1],
    'late submissions',
    'can I get an extension on it?',
  );
  const missing = contains(depth3.markdown, ['Free Ventures']);
  return {
    name: 'depth-3 referent: entity survives three brief compositions',
    pass: missing.length === 0,
    detail: missing.length
      ? `depth-3 brief lost the referent — facts: ${depth3.facts.join(' | ').slice(0, 200)}`
      : `resolved through three composed briefs (${depth3.facts.length} facts)`,
  };
}

/**
 * The population prior, end to end: a brand-new user (empty profile) inherits the community's
 * routing memory. Three users who each upgraded this lookup are folded with mergeProfiles; the
 * cold-start then routes the same question a tier up, and says the community is why. This is the
 * network-effect claim — more users → better cold-start — executed rather than asserted.
 */
async function populationPriorCase(): Promise<Verdict> {
  const question = 'When do Free Ventures applications close?';
  const brief: ContextBrief = {
    id: 'eval_brief_p',
    branchId: 'eval_branch_p',
    selection: 'Free Ventures',
    markdown: '- Free Ventures applications close September 11.',
    facts: ['Free Ventures applications close September 11.'],
    excludedNote: 'Excluded: everything else.',
    availableTokens: 5000,
    briefTokens: 60,
    prunedPct: 98.8,
  };

  let one = emptyProfile();
  for (let i = 0; i < 3; i += 1) {
    one = recordFeedback(one, { kind: 'override', classifiedTier: 'quick', chosenTier: 'deep' });
  }
  const population = mergeProfiles([one, one, one]);

  const cold = await route({ question, brief, contextTokens: 60 });
  const warm = await route({
    question,
    brief,
    contextTokens: 60,
    profile: emptyProfile(),
    population,
  });

  const pass =
    cold.tier === 'quick' &&
    warm.tier === 'thoughtful' &&
    warm.learned === true &&
    /community/i.test(warm.reason);
  return {
    name: 'population prior: a new user cold-starts from the community and the reason says so',
    pass,
    detail: `cold=${cold.tier} → warm=${warm.tier} (learned=${warm.learned}) — "${warm.reason.slice(0, 90)}"`,
  };
}

/**
 * The merge loop is closed: an insight distilled from a branch actually re-enters the parent's
 * prompt. The original deep-read finding was "merge is theater — insights are stored and rendered
 * but never re-enter any prompt"; this executes the fix.
 */
async function mergeLoopCase(): Promise<Verdict> {
  const parent = conv({
    id: 'eval_merge_parent',
    title: 'Berkeley clubs research',
    messages: [
      msg('user', 'I am figuring out which Berkeley clubs to join this fall.'),
      msg('assistant', 'Worth a look: Free Ventures, ML@B, and Blueprint.'),
    ],
    insights: [
      {
        id: 'eval_insight_1',
        branchId: 'eval_merge_branch',
        parentId: 'eval_merge_parent',
        text: 'Free Ventures applications close September 11.',
        createdAt: new Date().toISOString(),
      },
    ],
  });
  const { context } = renderChatContext(parent);
  const missing = contains(context, ['Learned from branches', 'September 11']);
  return {
    name: 'merge loop: a merged insight re-enters the parent prompt context',
    pass: missing.length === 0,
    detail: missing.length
      ? `parent context missing: ${missing.join(', ')}`
      : 'insight present under "Learned from branches"',
  };
}

async function main() {
  console.log(`bonsai evals — provider: ${providerName()}\n`);
  const verdicts: Verdict[] = [];
  for (const c of CASES) verdicts.push(await runCase(c));
  verdicts.push(await depthTwoCase());
  verdicts.push(await depthThreeCase());
  verdicts.push(await salienceCase());
  verdicts.push(await learningCase());
  verdicts.push(await populationPriorCase());
  verdicts.push(await mergeLoopCase());

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
