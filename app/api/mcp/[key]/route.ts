/**
 * Remote MCP connector (Streamable HTTP) for claude.ai custom connectors.
 * The [key] path segment is a per-user garden key validated against mcp_users;
 * a Bearer token is accepted as an alternative carrier for the same key.
 * Origin is deliberately not strict-validated — claude.ai's initialize breaks on it.
 */
import { createMcpHandler } from 'mcp-handler';
import { validateKey } from '@/lib/mcp-store';
import { registerBonsaiTools } from './tools';

export const maxDuration = 60;

const INSTRUCTIONS =
  'Bonsai runs a fork/merge loop for side-questions: compile a minimal referent-resolved brief ' +
  'in-conversation, bonsai_fork it to get a paste-ready brief for a new chat, answer it there, ' +
  'then bonsai_merge the distilled insight (≤30 words) back. bonsai_tree shows the garden.';

function bearerKey(req: Request): string | null {
  const match = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function buildHandler(userKey: string): (req: Request) => Promise<Response> {
  return createMcpHandler(
    (server) => registerBonsaiTools(server, userKey),
    { serverInfo: { name: 'bonsai', version: '0.1.0' }, instructions: INSTRUCTIONS },
  );
}

async function handle(req: Request, ctx: { params: Promise<{ key: string }> }): Promise<Response> {
  const { key: pathKey } = await ctx.params;
  const key = bearerKey(req) ?? pathKey;
  if (!(await validateKey(key))) {
    return Response.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    );
  }
  return buildHandler(key)(req);
}

export { handle as GET, handle as POST };
