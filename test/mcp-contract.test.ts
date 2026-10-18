import { beforeAll, describe, expect, it, vi } from 'vitest';

// The live connector's users have tool names and input schemas baked into their claude.ai
// sessions. Changing this snapshot is a contract change: new fields must be optional, and
// names and existing inputs stay frozen.

const DEV_KEY = 'bonsai-dev-key';

interface ToolEntry {
  name: string;
  inputSchema: unknown;
  outputSchema?: unknown;
}

function parseRpc(contentType: string, raw: string): { result?: Record<string, unknown> } {
  if (!contentType.includes('text/event-stream')) return JSON.parse(raw);
  const frames = raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  return JSON.parse(frames[frames.length - 1]);
}

async function rpc(
  handler: (req: Request) => Promise<Response>,
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const res = await handler(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  expect(res.status).toBe(200);
  const body = parseRpc(res.headers.get('content-type') ?? '', await res.text());
  return body.result ?? {};
}

async function listTools(handler: (req: Request) => Promise<Response>, headers?: Record<string, string>) {
  await rpc(
    handler,
    'initialize',
    { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'contract', version: '0' } },
    headers,
  );
  const result = await rpc(handler, 'tools/list', {}, headers);
  return (result.tools as ToolEntry[])
    .map(({ name, inputSchema, outputSchema }) => ({ name, inputSchema, outputSchema }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe('MCP connector tool contract', () => {
  let keyed: ToolEntry[];
  let bearer: ToolEntry[];

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', '');
    const keyRoute = await import('../app/api/mcp/[key]/route');
    const bearerRoute = await import('../app/api/mcp/route');
    keyed = await listTools((req) => keyRoute.POST(req, { params: Promise.resolve({ key: DEV_KEY }) }));
    bearer = await listTools(bearerRoute.POST, { authorization: `Bearer ${DEV_KEY}` });
  });

  it('keeps the four tool names', () => {
    expect(keyed.map((t) => t.name)).toEqual(['bonsai_abandon', 'bonsai_fork', 'bonsai_merge', 'bonsai_tree']);
  });

  it('matches the frozen tools/list schemas', async () => {
    await expect(JSON.stringify(keyed, null, 2) + '\n').toMatchFileSnapshot('./__contract__/mcp-tools-list.json');
  });

  it('serves the same contract on the key-in-URL and bearer endpoints', () => {
    expect(bearer).toEqual(keyed);
  });
});
