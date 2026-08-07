/**
 * Engine smoke test — compiles briefs and routes the two DEMO.md questions in isolation.
 *
 * Run:  npx tsx --env-file=.env.local scripts/try-engine.ts
 * With no Snowflake keys this exercises mock mode, which is a valid pass.
 */
import seed from '../fixtures/seed-conversation.json';
import { compileBrief } from '../lib/compiler';
import { isCortexEnabled } from '../lib/llm';
import { MODEL_TIERS } from '../lib/models';
import { completeWithEscalation, route } from '../lib/router';
import { messagesTokens } from '../lib/tokens';
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
  console.log(`cortex enabled: ${isCortexEnabled()}  models: ${JSON.stringify(MODEL_TIERS)}`);
  const available = messagesTokens(fixture.messages);
  console.log(`parent history: ${fixture.messages.length} messages, ~${available} tokens\n`);

  for (const [i, testCase] of CASES.entries()) {
    console.log(`--- case ${i + 1}: "${testCase.question}"`);

    const brief = await compileBrief({
      briefId: `brief_${i}`,
      branchId: `branch_${i}`,
      parentMessages: fixture.messages,
      profile: fixture.profile,
      selection: testCase.selection,
      question: testCase.question,
      availableTokens: available,
    });

    console.log(`brief: ${available} -> ${brief.briefTokens} tokens (${brief.prunedPct}% pruned)`);
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
