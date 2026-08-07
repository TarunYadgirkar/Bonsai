/**
 * Confirms a live LLM key works before the demo depends on it.
 *
 *   npx tsx --env-file=.env.local scripts/try-provider.ts
 *
 * Prints which provider is active and the upstream model each Bonsai rung maps to, then makes one
 * real call per rung. A rung that fails prints the API's own error — the usual cause is a model id
 * this account cannot use, which is an env override away (BONSAI_MODEL_OPENAI_QUICK=…), not a code
 * change. Any failure at runtime degrades to the mock, so a red line here means "that rung will be
 * mock on stage", not "the app is broken".
 */
import { MODELS } from '../lib/models';
import { providerComplete, providerSummary } from '../lib/provider';

async function main(): Promise<void> {
  const summary = providerSummary();
  console.log(`provider: ${summary.provider}`);
  if (summary.provider === 'mock') {
    console.log('No ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY set — the app runs on the mock.');
    return;
  }
  console.log('model map:', summary.models, '\n');

  for (const model of MODELS) {
    const started = Date.now();
    const result = await providerComplete({
      model: model.id,
      messages: [
        { role: 'system', content: 'Answer in one short sentence.' },
        { role: 'user', content: 'Name one reason branching a conversation beats one long thread.' },
      ],
      maxTokens: 120,
    });
    const ms = Date.now() - started;
    if (!result) {
      console.log(`✗ ${model.label.padEnd(10)} FAILED — see the warning above. This rung is mock.`);
      continue;
    }
    console.log(
      `✓ ${model.label.padEnd(10)} ${String(ms).padStart(5)}ms  ${result.servedBy}  ` +
        `${result.inputTokens}in/${result.outputTokens}out  "${result.text.trim().slice(0, 60)}…"`,
    );
  }
}

main().catch((err) => {
  console.error(`try-provider failed: ${(err as Error).message}`);
  process.exit(1);
});
