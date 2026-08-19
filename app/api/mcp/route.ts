/**
 * Bearer-only MCP endpoint — the OAuth front door. claude.ai hits this URL with no credentials,
 * gets a 401 whose WWW-Authenticate points at the Protected Resource Metadata, runs Dynamic
 * Client Registration + PKCE through /api/oauth/*, and returns with a bearer token that maps to
 * a garden key. A raw garden key as the bearer works too (same trust, different carrier), so
 * /connect links and OAuth grants land in the same garden model. The legacy key-in-URL path
 * (/api/mcp/[key]) stays untouched for existing installs.
 */
import { createMcpHandler } from 'mcp-handler';
import { keyForToken } from '@/lib/oauth';
import { validateKey } from '@/lib/mcp-store';
import { registerBonsaiTools } from './[key]/tools';

export const maxDuration = 60;

const INSTRUCTIONS =
  'Bonsai runs a fork/merge loop for side-questions: compile a minimal referent-resolved brief ' +
  'in-conversation, bonsai_fork it to get a paste-ready brief for a new chat, answer it there, ' +
  'then bonsai_merge the distilled insight (≤30 words) back. bonsai_tree shows the garden.';

function unauthorized(origin: string): Response {
  return Response.json(
    { error: 'unauthorized' },
    {
      status: 401,
      headers: {
        // This header is the OAuth trigger: claude.ai follows it to the PRM and starts DCR.
        'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      },
    },
  );
}

async function handle(req: Request): Promise<Response> {
  const origin = new URL(req.url).origin;
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!bearer) return unauthorized(origin);

  let key: string | null = await keyForToken(bearer);
  if (!key && (await validateKey(bearer))) key = bearer;
  if (!key) return unauthorized(origin);

  const handler = createMcpHandler((server) => registerBonsaiTools(server, key), {
    serverInfo: { name: 'bonsai', version: '0.1.0' },
    instructions: INSTRUCTIONS,
  });
  return handler(req);
}

export { handle as GET, handle as POST };
