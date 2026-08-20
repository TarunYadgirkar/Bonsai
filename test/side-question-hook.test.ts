import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function run(prompt: string, raw = false): string {
  return execFileSync('node', ['plugin/hooks/side-question.mjs'], {
    input: raw ? prompt : JSON.stringify({ prompt }),
    encoding: 'utf8',
  });
}

describe('side-question hook', () => {
  it('nudges on tangent cues with the cue named', () => {
    const out = JSON.parse(run('btw how does the neon pooler behave under transaction mode?'));
    expect(out.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(out.hookSpecificOutput.additionalContext).toContain('cue: "btw"');
    expect(out.hookSpecificOutput.additionalContext).toContain('branch skill');
  });

  it('stays silent without a cue, when bonsai-aware, when short, and on bad input', () => {
    expect(run('fix the failing test in store.ts please')).toBe('');
    expect(run('btw can you branch this off with bonsai')).toBe('');
    expect(run('btw thanks')).toBe('');
    expect(run('not json at all', true)).toBe('');
  });

  it('matches multiword cues', () => {
    const out = JSON.parse(
      run('quick question while I have you — what is the difference between PRM and AS metadata?'),
    );
    expect(out.hookSpecificOutput.additionalContext).toContain('quick question');
  });
});
