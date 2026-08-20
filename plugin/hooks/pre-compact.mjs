#!/usr/bin/env node
/**
 * PreCompact hook: compaction is exactly the moment Bonsai exists for — the context grew past
 * its useful size because tangents rode the trunk. Two honest interventions, no blocking:
 * instruct the summarizer to preserve Bonsai state verbatim (branch ids, briefs, merged
 * insights die badly when paraphrased — the referent-resolution problem), and on AUTO compacts
 * plant the suggestion that the recurring sub-topics be forked with /bonsai:branch next time
 * instead of waiting for the next compaction.
 */
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  let trigger = 'auto';
  try {
    trigger = String(JSON.parse(Buffer.concat(chunks).toString()).trigger ?? 'auto');
  } catch {
    /* default to auto */
  }
  const lines = [
    'Bonsai plugin, compaction instructions:',
    '- Preserve VERBATIM (never paraphrase): every Bonsai branch id, compiled brief fact list,',
    '  and merged insight line in this conversation. Paraphrase kills their resolved referents.',
    '- Preserve which Bonsai branches are still open and what each was asked.',
  ];
  if (trigger === 'auto') {
    lines.push(
      '- After compaction, briefly suggest to the user: recurring side-topics in this session',
      '  could be forked with /bonsai:branch (compiled brief, one-insight merge) so the trunk',
      '  stays lean instead of hitting auto-compact again. One sentence, only if Bonsai-shaped',
      '  tangents actually occurred; otherwise say nothing.',
    );
  }
  process.stdout.write(lines.join('\n'));
  process.exit(0);
});
