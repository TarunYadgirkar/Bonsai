import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('plugin MCP bundle', () => {
  it('never reads GEMINI_API_KEY, so a Gemini CLI user is not billed by the plugin', () => {
    const bundle = readFileSync(join(__dirname, '../plugin/mcp/dist/server.mjs'), 'utf8');
    expect(bundle).toContain('generativelanguage.googleapis.com');
    expect(bundle).not.toContain('process.env.GEMINI_API_KEY');
  });
});
