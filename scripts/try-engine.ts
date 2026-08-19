/**
 * Engine smoke test — compiles briefs and routes two fixture questions in isolation.
 * Superseded by evals/ for correctness gating; kept as a quick manual poke.
 *
 * Run:  npx tsx --env-file=.env.local scripts/try-engine.ts
 * With no provider keys this exercises mock mode, which is a valid pass.
 */
import {
  MODEL_TIERS,
  compileBrief,
  completeWithEscalation,
  messagesTokens,
  providerName,
  route,
} from 'bonsai-engine';
import seed from '../fixtures/seed-conversation.json';
import type { SeedConversation } from '../lib/types';

const fixture = seed as SeedConversation;

const CASES = [
  { selection: 'Free Ventures', question: 'when do apps close?', expect: 'quick' },
  {
    selection: 'top 3 clubs',
    question:
      'Given my goals, workload, and everything we have learned, rank my top 3 clubs and explain the opportunity cost of each.',
    expect: 'deep',
  },
];

async function main() {
  console.log(`provider: ${providerName()}  models: ${JSON.stringify(MODEL_TIERS)}`);
  const available = messagesTokens(fixture.messages);
  console.log(`parent history: ${fixture.messages.length} messages, ~${available} tokens\n`);

  for (const [i, testCase] of CASES.entries()) {
    console.log(`--- case ${i + 1}: "${testCase.question}"`);

    const { brief, usage } = await compileBrief({
      briefId: `brief_${i}`,
      branchId: `branch_${i}`,
      pathMarkdown: fixture.messages.map((m) => `${m.role}: ${m.content}`).join('\n\n'),
      profile: fixture.profile,
      selection: testCase.selection,
      question: testCase.question,
      availableTokens: available,
    });

    console.log(
      `brief: ${available} -> ${brief.briefTokens} tokens (${brief.prunedPct}% pruned; compile cost $${usage.estCostUsd})`,
    );
    console.log(`facts:`);
    for (const fact of brief.facts) console.log(`  - ${fact}`);
    console.log(`excluded: ${brief.excludedNote}`);

    const routing = await route({
      question: testCase.question,
      brief,
      contextTokens: brief.briefTokens,
    });
    const verdict = routing.tier === testCase.expect ? 'PASS' : `MISMATCH (wanted ${testCase.expect})`;
    console.log(`route: ${routing.tier} / ${routing.model} / $${routing.estCostUsd} — ${verdict}`);
    console.log(`reason: ${routing.reason}`);

    const answer = await completeWithEscalation({
      routing,
      systemPrompt: 'You answer using only the compiled brief provided.',
      userPrompt: `${brief.markdown}\n\n---\n${testCase.question}`,
    });
    console.log(`answer: ${answer.text.slice(0, 200).replace(/\n/g, ' ')}`);
    if (answer.routing.escalated) console.log(`ESCALATED to ${answer.routing.tier}`);
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
