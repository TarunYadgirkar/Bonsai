import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPILER_SYSTEM_PROMPT } from '../packages/engine/src/compiler';

/** The Python COMPILER_SYSTEM: adjacent "..." literals inside the parenthesized assignment. */
function pythonCompilerSystem(): string {
  const source = readFileSync(join(__dirname, '../research/distill/src/bonsai_distill/prompts.py'), 'utf8');
  const block = /^COMPILER_SYSTEM = \(\n([\s\S]*?)\n\)/m.exec(source)?.[1];
  if (!block) throw new Error('COMPILER_SYSTEM assignment not found in prompts.py');
  const literals = block.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
  return literals.map((literal) => JSON.parse(literal) as string).join('');
}

describe('research/distill prompt drift', () => {
  it('trains on the same compiler system prompt the engine sends', () => {
    expect(pythonCompilerSystem()).toBe(COMPILER_SYSTEM_PROMPT);
  });
});
