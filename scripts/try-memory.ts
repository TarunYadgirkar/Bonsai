/**
 * EverOS round-trip smoke test. Writes one insight, then searches it back.
 *
 * Run:  npx tsx --env-file=.env.local scripts/try-memory.ts
 * With no key it exercises the local fallback instead, which is also a valid pass.
 */
import { isRemoteEnabled, searchMemories, writeInsight } from '../lib/memory';

const USER_ID = 'tarun';
const BRANCH_ID = `smoke_${Date.now()}`;
const INSIGHT = 'Free Ventures apps close Sept 11; user plans to apply with the startup.';

async function main() {
  console.log(`remote enabled: ${isRemoteEnabled()}`);

  const write = await writeInsight({ userId: USER_ID, branchId: BRANCH_ID, text: INSIGHT });
  console.log(`write: remote=${write.remote}`);

  const hits = await searchMemories({ query: 'When do Free Ventures applications close?', userId: USER_ID });
  console.log(`search: ${hits.length} hit(s)`);
  for (const hit of hits) {
    console.log(`  [${hit.score.toFixed(2)}] ${hit.text.slice(0, 120)}`);
  }

  if (!hits.length) {
    console.log('no hits — extraction may still be queued; re-run in a few seconds');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
