import { describe, expect, it } from 'vitest';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerBonsaiTools } from '../app/api/mcp/[key]/tools';
import { TREE_APP_HTML, TREE_UI_URI } from '../app/api/mcp/[key]/tree-app';

interface Captured {
  tools: Map<string, { config: Record<string, unknown> }>;
  resources: Map<string, { config: Record<string, unknown>; read: () => Promise<{ contents: { uri: string; mimeType?: string; text?: string }[] }> }>;
}

function fakeServer(): { server: McpServer; captured: Captured } {
  const captured: Captured = { tools: new Map(), resources: new Map() };
  const server = {
    registerTool: (name: string, config: Record<string, unknown>) => {
      captured.tools.set(name, { config });
    },
    registerResource: (
      name: string,
      uri: string,
      config: Record<string, unknown>,
      read: Captured['resources'] extends Map<string, infer V> ? (V extends { read: infer R } ? R : never) : never,
    ) => {
      captured.resources.set(uri, { config, read });
    },
  } as unknown as McpServer;
  return { server, captured };
}

describe('MCP Apps garden view', () => {
  const { server, captured } = fakeServer();
  registerBonsaiTools(server, 'test-key');

  it('bonsai_tree declares the ui resource in both meta spellings', () => {
    const meta = captured.tools.get('bonsai_tree')?.config._meta as Record<string, unknown>;
    expect((meta.ui as { resourceUri: string }).resourceUri).toBe(TREE_UI_URI);
    expect(meta['ui/resourceUri']).toBe(TREE_UI_URI);
  });

  it('serves the app HTML at the ui:// uri with the MCP Apps mime type', async () => {
    const resource = captured.resources.get(TREE_UI_URI)!;
    expect(resource.config.mimeType).toBe(RESOURCE_MIME_TYPE);
    const { contents } = await resource.read();
    expect(contents[0].mimeType).toBe(RESOURCE_MIME_TYPE);
    expect(contents[0].text).toBe(TREE_APP_HTML);
  });

  it('the app speaks the SEP-1865 handshake and renders from structuredContent', () => {
    for (const marker of [
      'ui/initialize',
      'ui/notifications/initialized',
      'ui/notifications/tool-result',
      'ui/notifications/size-changed',
      "protocolVersion: '2026-01-26'",
      'structuredContent',
      '</html>',
    ]) {
      expect(TREE_APP_HTML).toContain(marker);
    }
    // The template-literal container must not leak escapes: no backticks, no ${ interpolation.
    expect(TREE_APP_HTML).not.toContain('`');
    expect(TREE_APP_HTML).not.toContain('${');
  });
});
