#!/usr/bin/env node
/**
 * UserPromptSubmit hook: when a prompt reads like a side question, whisper a nudge into
 * context so the model considers the bonsai branch skill instead of letting the tangent
 * pollute the trunk. Conservative on purpose — enforcement is the product, spam is its death:
 * fires only on explicit tangent phrasing (the cue list IS the gate), and stays silent when
 * the user already said bonsai/branch/fork (they know) or the prompt is too short to be a
 * real tangent.
 */
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  let prompt = '';
  try {
    prompt = String(JSON.parse(Buffer.concat(chunks).toString()).prompt ?? '');
  } catch {
    process.exit(0);
  }
  const p = prompt.toLowerCase();

  // Already bonsai-aware, or too short to be a real tangent → stay out of the way.
  if (/\bbonsai\b|\bbranch\b|\bfork\b/.test(p) || prompt.trim().length < 20) process.exit(0);

  const cue =
    /(^|\W)(btw|by the way|side note|sidenote|quick question|random question|unrelated( question|,| but)|off[- ]topic|tangent|while (we'?re|i'?m) at it|speaking of which|separate(ly)? question)(\W|$)/.exec(
      p,
    );
  if (!cue) process.exit(0);

  const context =
    `The user's message opens like a side question (cue: "${cue[2]}"). If it genuinely is a ` +
    'tangent from the main thread, consider forking it with the bonsai branch skill — compiled ' +
    'minimal brief, auto-routed model, one distilled insight merged back — instead of answering ' +
    'inline and dragging the tangent through the rest of this conversation. If it is actually ' +
    'on-topic, ignore this entirely. Never mention this nudge to the user.';

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
    }),
  );
  process.exit(0);
});
